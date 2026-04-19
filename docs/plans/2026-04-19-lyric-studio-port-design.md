# Lyric Studio Port — Design Document

> **Goal:** Port the Lyric Studio / Lireek feature from HOT-Step 9000 (Python) into HOT-Step CPP as a pure TypeScript implementation — zero Python dependencies.

## Background

Lyric Studio is an AI-powered songwriting environment built on top of the **Lireek** project. It allows users to:

1. **Acquire** lyrics from Genius for any artist/album
2. **Profile** an artist's stylistic patterns using an LLM (themes, rhyme schemes, vocabulary, tone, structure)
3. **Generate** new original lyrics that authentically capture the artist's style
4. **Refine** generated lyrics through iterative LLM feedback
5. **Export** lyrics with metadata (BPM, key, caption, duration) ready for ACE-Step audio generation

### Current Architecture (HOT-Step 9000)

```
Browser (React UI)
  └→ Node.js Express (:3000)
       └→ HTTP Proxy: /api/lireek/* → Lireek Python FastAPI (:8002)
            └→ SQLite (lireek.db)
            └→ Genius REST API
            └→ LLM Providers (Gemini, OpenAI, Anthropic, Ollama, LM Studio, Unsloth)
```

### Target Architecture (HOT-Step CPP)

```
Browser (React UI)
  └→ Node.js Express (:3001)
       ├── /api/lireek/* → TypeScript services (NO Python)
       │    └→ SQLite via better-sqlite3 (lireek.db — SAME file)
       │    └→ Genius REST API via fetch()
       │    └→ LLM Providers via fetch() / OpenAI-compatible API
       └── /api/generate → ace-server.exe (:8085) [existing]
```

**No Python. Single process. Same database.**

---

## Why This Is Feasible

The Lireek Python backend contains **zero** Python-specific dependencies that require ML inference or native extensions. Every service is pure I/O:

| Python Service | LOC | What it does | TypeScript method |
|---|---|---|---|
| `storage_service.py` | 508 | SQLite CRUD | `better-sqlite3` (already in project) |
| `genius_service.py` | 666 | Genius REST API + HTML scraping | `fetch()` + `cheerio` |
| `llm_service.py` | 1935 | Multi-provider LLM calls (REST APIs) | `fetch()` (OpenAI-compatible) |
| `profiler_service.py` | ~900 | Prompt construction + response parsing | String templates + JSON.parse |
| `export_service.py` | ~120 | Write JSON/TXT files | `fs.writeFileSync` |
| `slop_detector.py` | ~450 | Regex-based AI text detection | JS regex (compatible) |

**Total: ~4,600 lines of Python → ~3,600 lines of TypeScript**

The 1,935-line `llm_service.py` breaks down as:
- ~800 lines of **prompt template strings** (copy-paste into TS)
- ~400 lines of **post-processing** (regex, line counting — language-agnostic)
- ~500 lines of **provider classes** (each wraps a REST API call)
- ~235 lines of **metadata planning** (prompt + JSON parsing)

---

## Database Schema

The existing `lireek.db` (4.39 MB) uses standard SQLite3. `better-sqlite3` reads it directly.

### Core Tables (from Lireek standalone)

```sql
-- Artists
CREATE TABLE artists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    image_url   TEXT,          -- added by migration
    genius_id   INTEGER,       -- added by migration
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lyrics Sets (fetched lyrics grouped by artist + album)
CREATE TABLE lyrics_sets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_id   INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    album       TEXT,
    image_url   TEXT,          -- added by migration
    max_songs   INTEGER NOT NULL DEFAULT 10,
    songs       TEXT NOT NULL,  -- JSON array of {title, album, lyrics}
    fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Profiles (stylistic fingerprints built from lyrics)
CREATE TABLE profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lyrics_set_id   INTEGER NOT NULL REFERENCES lyrics_sets(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    profile_data    TEXT NOT NULL,  -- JSON of full LyricsProfile
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generations (AI-written songs)
CREATE TABLE generations (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id            INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider              TEXT NOT NULL,
    model                 TEXT NOT NULL,
    extra_instructions    TEXT,
    title                 TEXT NOT NULL DEFAULT '',
    subject               TEXT NOT NULL DEFAULT '',
    lyrics                TEXT NOT NULL,
    system_prompt         TEXT NOT NULL DEFAULT '',
    user_prompt           TEXT NOT NULL DEFAULT '',
    bpm                   INTEGER NOT NULL DEFAULT 0,
    key                   TEXT NOT NULL DEFAULT '',
    caption               TEXT NOT NULL DEFAULT '',
    duration              INTEGER NOT NULL DEFAULT 0,
    parent_generation_id  INTEGER REFERENCES generations(id) ON DELETE SET NULL,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Settings (key-value store)
CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
```

### HOT-Step Integration Tables (added by the 9000 UI)

These tables are referenced in `lyricStudioApi.ts` and managed by the Node server:

```sql
-- Album Presets (LoRA adapter + reference track per album)
CREATE TABLE IF NOT EXISTS album_presets (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    lyrics_set_id         INTEGER NOT NULL REFERENCES lyrics_sets(id) ON DELETE CASCADE,
    adapter_path          TEXT,
    adapter_scale         REAL,
    adapter_group_scales  TEXT,  -- JSON: {self_attn, cross_attn, mlp, cond_embed}
    reference_track_path  TEXT,
    audio_cover_strength  REAL,
    created_at            TEXT DEFAULT (datetime('now'))
);

-- Audio Generations (links a lyric generation to a HOT-Step audio job)
CREATE TABLE IF NOT EXISTS audio_generations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_id   INTEGER NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    hotstep_job_id  TEXT NOT NULL,
    audio_url       TEXT,
    cover_url       TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);
```

### Database Migration Strategy

1. **Copy** `D:\Ace-Step-Latest\Lireek\backend\data\lireek.db` → `D:\Ace-Step-Latest\hot-step-cpp\data\lireek.db`
2. **Init function** runs `CREATE TABLE IF NOT EXISTS` for all tables + migration `ALTER TABLE` statements
3. Existing data preserved, new tables created if missing

---

## New npm Dependencies

| Package | Purpose | Size |
|---|---|---|
| `cheerio` | HTML parsing for Genius lyrics scraping (replaces BeautifulSoup) | ~750KB |

Everything else uses `fetch()` (built into Node 18+) and `better-sqlite3` (already installed).

> **Decision:** Use raw `fetch()` for ALL LLM providers rather than provider-specific SDKs. This keeps dependencies minimal and the codebase consistent. All providers either use the OpenAI-compatible chat completions API or have simple REST endpoints.

---

## Server-Side Implementation

### New Files

```
server/src/
├── db/
│   └── lireekDb.ts              # Lireek SQLite schema + CRUD queries
├── services/
│   ├── lireek/
│   │   ├── geniusService.ts     # Genius API + lyrics scraping
│   │   ├── llmService.ts        # Multi-provider LLM abstraction
│   │   ├── profilerService.ts   # Artist profile building
│   │   ├── slopDetector.ts      # AI slop detection (regex patterns)
│   │   ├── exportService.ts     # JSON/TXT file export
│   │   └── prompts.ts           # All prompt templates (extracted constants)
│   └── (existing services)
├── routes/
│   └── lireek.ts                # Express router: /api/lireek/*
└── (existing files)
```

### Modified Files

| File | Change |
|---|---|
| `server/src/config.ts` | Add `lireek` config section (Genius token, LLM API keys, export dir) |
| `server/src/index.ts` | Mount `/api/lireek` routes |
| `.env.example` | Add `GENIUS_ACCESS_TOKEN`, `GEMINI_API_KEY`, etc. |

### Service Details

#### `lireekDb.ts` — Database Layer (~400 lines)

Direct port of `storage_service.py`. Uses the existing `better-sqlite3` pattern. Opens `data/lireek.db` as a **separate database** from `hotstep.db` (they serve different purposes and this preserves the ability to copy the DB independently).

Key functions:
- `initLireekDb()` — Create tables + run migrations
- `getOrCreateArtist(name)`, `listArtists()`, `deleteArtist(id)`
- `saveLyricsSet(...)`, `getLyricsSets(artistId?)`, `getLyricsSet(id)`, `deleteLyricsSet(id)`
- `saveProfile(...)`, `getProfiles(lyricsSetId?)`, `getProfile(id)`, `deleteProfile(id)`
- `saveGeneration(...)`, `getGenerations(profileId?, lyricsSetId?)`, `getAllGenerationsWithContext()`
- `updateGenerationMetadata(...)`, `deleteGeneration(id)`
- `getSetting(key)`, `setSetting(key, value)`
- Album presets: `getPreset(lyricsSetId)`, `upsertPreset(...)`, `deletePreset(lyricsSetId)`
- Audio generations: `linkAudio(generationId, jobId)`, `getAudioGenerations(generationId)`, `resolveAudioGeneration(jobId, audioUrl, coverUrl?)`

#### `geniusService.ts` — Lyrics Acquisition (~350 lines)

Port of `genius_service.py`. Uses `fetch()` for the Genius REST API and `cheerio` for HTML parsing (replacing BeautifulSoup).

Key functions:
- `fetchLyrics(artistName, albumName?, maxSongs)` — Main entry point
- `_apiSearch(query)`, `_apiGetArtistSongs(artistId)`, `_apiGetAlbumTracks(albumId)`
- `_scrapeLyrics(songUrl)` — Scrape + clean lyrics from a Genius page
- `_cleanLyrics(raw)` — Strip Genius artefacts
- `_findArtistId(name)`, `_findAlbumId(albumName, artistName)`
- `searchSongLyrics(artist, title)` — Single song lookup (for Cover Studio)

#### `llmService.ts` — LLM Provider Abstraction (~800 lines)

Port of `llm_service.py`. Each provider wraps `fetch()` calls to REST APIs.

**Provider implementations:**

| Provider | API Pattern | Auth |
|---|---|---|
| Gemini | `POST generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | API key in URL |
| OpenAI | `POST api.openai.com/v1/chat/completions` | Bearer token |
| Anthropic | `POST api.anthropic.com/v1/messages` | `x-api-key` header |
| Ollama | `POST localhost:11434/api/chat` | None |
| LM Studio | `POST localhost:1234/v1/chat/completions` (OpenAI-compatible) | None |
| Unsloth | `POST localhost:8888/v1/chat/completions` (OpenAI-compatible) | Basic auth |

**Shared interface:**
```typescript
interface LLMProvider {
  id: string;
  name: string;
  defaultModel: string;
  isAvailable(): boolean;
  listModels(): Promise<string[]>;
  call(systemPrompt: string, userPrompt: string, options?: {
    model?: string;
    temperature?: number;
    topP?: number;
    onChunk?: (text: string) => void;  // SSE streaming
  }): Promise<string>;
}
```

**Key functions:**
- `getProvider(name)`, `listProviders()` — Provider registry
- `generateLyrics(profile, providerName, model?, extraInstructions?, usedSubjects?, ...)` — Full generation pipeline
- `generateLyricsStreaming(...)` — SSE streaming variant
- `refineLyrics(originalLyrics, artistName, title, providerName, model?, profile?, ...)` — Refine existing lyrics
- `planSongMetadata(profile, usedSubjects, usedBpms, usedKeys, ...)` — Plan BPM/key/caption/subject

**Post-processing (ported from Python):**
- `postprocessLyrics(text)` — Fix section headers, add punctuation
- `enforceLineCounts(text)` — Trim verses to 4/8 lines, choruses to 4/6/8
- `fixAPrefix(text)` — Strip bad "a-" prefixes
- `stripThinkingBlocks(text)` — Remove CoT output from thinking models
- `extractJsonObject(text)` — Robust JSON extraction
- `estimateDuration(lyrics, bpm)` — Math-based duration estimate

#### `prompts.ts` — Prompt Templates (~300 lines)

All prompt constants extracted from `llm_service.py`:
- `GENERATION_SYSTEM_PROMPT` — Master songwriting instruction
- `SONG_METADATA_SYSTEM_PROMPT` — Metadata planning instruction
- `PROFILE_SYSTEM_PROMPT` — Profile building instruction (from `profiler_service.py`)
- `REFINE_SYSTEM_PROMPT` — Refinement instruction
- `buildGenerationPrompt(profile, extraInstructions?, usedTitles?)` — Dynamic prompt builder

#### `profilerService.ts` — Profile Building (~500 lines)

Port of `profiler_service.py`. Builds `LyricsProfile` objects from analyzed lyrics.

**Two-phase approach:**
1. **Rule-based analysis** — Line counting, section identification, rhyme scheme detection, vocabulary stats
2. **LLM-powered analysis** — Deep thematic/stylistic profiling via the configured LLM

Key functions:
- `buildProfile(artist, album, songs, llmCall, onPhase?)` — Main entry point
- `analyzeStructure(songs)` — Section/line/meter statistics
- `analyzeVocabulary(songs)` — Contraction frequency, type-token ratio, distinctive words
- `analyzeRepetition(songs)` — Hook/chorus repetition patterns

> **Note on NLTK dependency:** The Python version uses `nltk` for syllable counting. In TypeScript, we'll use a simple syllable estimation function (count vowel groups) which is sufficient for the statistical purpose here. No npm package needed.

#### `slopDetector.ts` — AI Slop Detection (~250 lines)

Port of `slop_detector.py`. Pure regex pattern matching.

- `BLACKLISTED_WORDS` — Set of banned AI cliché words
- `BLACKLISTED_PHRASES` — Set of banned AI cliché phrases
- `scanForSlop(text)` — Returns detected slop with scores

#### `exportService.ts` — File Export (~80 lines)

Port of `export_service.py`. Writes generation data to JSON + TXT files.

- `exportGeneration(generation, artistName, albumName, exportDir)` — Write files to disk

#### `lireek.ts` — Express Routes (~500 lines)

All `/api/lireek/*` endpoints. Direct port of `api.py` router.

**Endpoints (matching `lyricStudioApi.ts` client exactly):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/lireek/artists` | List artists |
| POST | `/api/lireek/artists/create` | Create artist manually |
| DELETE | `/api/lireek/artists/:id` | Delete artist |
| POST | `/api/lireek/artists/:id/refresh-image` | Refresh artist image |
| POST | `/api/lireek/artists/:id/set-image` | Set artist image URL |
| POST | `/api/lireek/artists/:id/curated-profile` | Build curated profile |
| POST | `/api/lireek/artists/:id/curated-profile-stream` | Build curated profile (SSE) |
| GET | `/api/lireek/lyrics-sets` | List lyrics sets |
| POST | `/api/lireek/lyrics-sets/create` | Create lyrics set manually |
| GET | `/api/lireek/lyrics-sets/:id` | Get lyrics set |
| GET | `/api/lireek/lyrics-sets/:id/full-detail` | Get full album detail |
| DELETE | `/api/lireek/lyrics-sets/:id` | Delete lyrics set |
| DELETE | `/api/lireek/lyrics-sets/:id/songs/:index` | Remove song from set |
| PUT | `/api/lireek/lyrics-sets/:id/songs/:index` | Edit song lyrics |
| POST | `/api/lireek/lyrics-sets/:id/refresh-image` | Refresh album image |
| POST | `/api/lireek/lyrics-sets/:id/set-image` | Set album image URL |
| POST | `/api/lireek/lyrics-sets/:id/add-song` | Add song to set |
| POST | `/api/lireek/fetch-lyrics` | Fetch lyrics from Genius |
| GET | `/api/lireek/profiles` | List profiles |
| GET | `/api/lireek/profiles/:id` | Get profile |
| DELETE | `/api/lireek/profiles/:id` | Delete profile |
| POST | `/api/lireek/lyrics-sets/:id/build-profile` | Build profile |
| POST | `/api/lireek/lyrics-sets/:id/build-profile-stream` | Build profile (SSE) |
| GET | `/api/lireek/generations` | List generations |
| GET | `/api/lireek/generations/all` | List all with context |
| GET | `/api/lireek/generations/:id` | Get generation |
| PATCH | `/api/lireek/generations/:id` | Update metadata |
| DELETE | `/api/lireek/generations/:id` | Delete generation |
| POST | `/api/lireek/profiles/:id/generate` | Generate lyrics |
| POST | `/api/lireek/profiles/:id/generate-stream` | Generate lyrics (SSE) |
| POST | `/api/lireek/generations/:id/refine` | Refine lyrics |
| POST | `/api/lireek/generations/:id/refine-stream` | Refine lyrics (SSE) |
| POST | `/api/lireek/generations/:id/export` | Export generation |
| POST | `/api/lireek/generations/:id/audio` | Link audio generation |
| GET | `/api/lireek/generations/:id/audio` | Get audio generations |
| DELETE | `/api/lireek/audio-generations/:id` | Delete audio generation |
| PATCH | `/api/lireek/audio-generations/resolve` | Resolve audio URL |
| GET | `/api/lireek/lyrics-sets/:id/preset` | Get album preset |
| PUT | `/api/lireek/lyrics-sets/:id/preset` | Upsert album preset |
| DELETE | `/api/lireek/lyrics-sets/:id/preset` | Delete album preset |
| GET | `/api/lireek/presets` | List all presets |
| POST | `/api/lireek/slop-scan` | Scan text for AI slop |
| POST | `/api/lireek/purge` | Purge all profiles + generations |
| GET | `/api/lireek/prompts` | List prompt templates |
| PUT | `/api/lireek/prompts/:name` | Save prompt override |
| DELETE | `/api/lireek/prompts/:name` | Reset prompt to default |
| GET | `/api/lireek/recent-songs` | Recent songs across all artists |
| POST | `/api/lireek/search-song-lyrics` | Search Genius for a single song |
| POST | `/api/lireek/skip-thinking` | Skip LLM thinking phase |
| GET | `/api/lireek/providers` | List LLM providers |

**SSE Streaming pattern (replaces Python threading + queue):**
```typescript
// Node.js SSE is simpler than Python's threading approach
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.socket?.setNoDelay(true);

const onChunk = (text: string) => {
  res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
};

try {
  const result = await generateLyrics(..., { onChunk });
  res.write(`data: ${JSON.stringify({ type: 'result', data: result })}\n\n`);
} catch (err) {
  res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
}
res.end();
```

---

## UI Implementation

### Source Material

The HOT-Step 9000 has a mature "v2" Lyric Studio UI:
- `hot-step-9000/ace-step-ui/components/lyric-studio/v2/` — **24 files, ~250KB**
- `hot-step-9000/ace-step-ui/services/lyricStudioApi.ts` — **456 lines** (typed API client)

### Files to Port

```
ui/src/
├── services/
│   └── lireekApi.ts            # API client (copied + adapted from lyricStudioApi.ts)
├── components/
│   └── lyric-studio/           # All ported from v2/
│       ├── LyricStudio.tsx     # Main container (replaces LyricStudioV2.tsx)
│       ├── ArtistGrid.tsx      # Artist card grid
│       ├── AlbumGrid.tsx       # Album/lyrics-set grid for an artist
│       ├── AlbumHeader.tsx     # Album detail header
│       ├── ArtistPageSidebar.tsx
│       ├── ArtistSidebar.tsx
│       ├── ContentTabs.tsx     # Tab navigation
│       ├── SourceLyricsTab.tsx # View fetched source lyrics
│       ├── ProfilesTab.tsx    # Built profiles
│       ├── WrittenSongsTab.tsx # Generated songs
│       ├── RecordingsTab.tsx   # Audio generations
│       ├── RightSidebarPanel.tsx
│       ├── FetchLyricsModal.tsx
│       ├── AddArtistModal.tsx
│       ├── AddAlbumModal.tsx
│       ├── AddSongModal.tsx
│       ├── CuratedProfileModal.tsx
│       ├── PresetSettingsModal.tsx
│       ├── PromptEditor.tsx    # Custom prompt editing
│       ├── ProviderSelector.tsx # LLM provider/model picker
│       ├── StreamingPanel.tsx  # Shows streaming LLM output
│       ├── AudioJobProgress.tsx
│       ├── InlineAudioQueue.tsx
│       ├── FloatingPlaylist.tsx
│       └── RecentSongsList.tsx
├── stores/
│   └── useLyricStudio.ts      # Zustand store (optional)
└── hooks/
    └── useAudioGeneration.ts   # Hook for submitting audio jobs
```

### Modified UI Files

| File | Change |
|---|---|
| `ui/src/App.tsx` | Add `'lyric-studio'` to `activeView` routing |
| `ui/src/components/sidebar/Sidebar.tsx` | Add Lyric Studio nav icon |

### Styling Approach

The v2 components use inline styles and CSS classes. The CPP app uses **TailwindCSS**. Components will be adapted to use Tailwind utility classes for consistency with the existing CPP UI aesthetic.

---

## Configuration

### `.env` additions

```env
# ── Lyric Studio / Lireek ──────────────────────────────────────────
# Genius API (required for lyrics fetching)
GENIUS_ACCESS_TOKEN=

# LLM Providers (at least one required for profile building + generation)
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
LMSTUDIO_BASE_URL=http://localhost:1234/v1
UNSLOTH_BASE_URL=http://127.0.0.1:8888
UNSLOTH_USERNAME=
UNSLOTH_PASSWORD=

# Default LLM provider: gemini | openai | anthropic | ollama | lmstudio | unsloth
DEFAULT_LLM_PROVIDER=gemini

# Default models per provider
GEMINI_MODEL=gemini-2.5-flash
OPENAI_MODEL=gpt-4o-mini
ANTHROPIC_MODEL=claude-3-5-haiku-20241022
OLLAMA_MODEL=llama3
LMSTUDIO_MODEL=
UNSLOTH_MODEL=

# Export directory for generated lyrics
LYRICS_EXPORT_DIR=D:\Ace-Step-Latest\Lyrics
```

### `config.ts` additions

```typescript
lireek: {
  geniusAccessToken: process.env.GENIUS_ACCESS_TOKEN || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
  unslothBaseUrl: process.env.UNSLOTH_BASE_URL || 'http://127.0.0.1:8888',
  unslothUsername: process.env.UNSLOTH_USERNAME || '',
  unslothPassword: process.env.UNSLOTH_PASSWORD || '',
  defaultProvider: process.env.DEFAULT_LLM_PROVIDER || 'gemini',
  exportDir: process.env.LYRICS_EXPORT_DIR || path.join(config.data.dir, 'lyrics'),
  get dbPath() { return path.join(config.data.dir, 'lireek.db'); },
},
```

---

## Phased Delivery

### Phase 1 — Foundation (DB + Genius + CRUD routes)

**Goal:** See your existing artists, lyrics sets, and profiles in the CPP app.

1. Copy `lireek.db` to `data/`
2. Implement `lireekDb.ts` — full CRUD layer
3. Implement `geniusService.ts` — lyrics fetching
4. Implement `slopDetector.ts` — pattern matching
5. Implement `exportService.ts` — file export
6. Create `lireek.ts` routes — all CRUD endpoints (read-only first)
7. Add config + env vars
8. Mount routes in `index.ts`
9. Install `cheerio` dependency

**Verification:** Hit `/api/lireek/artists` from browser — should return all your existing artists.

### Phase 2 — LLM Engine (providers + profiling + generation)

**Goal:** Build profiles and generate new lyrics from the CPP app.

1. Implement `prompts.ts` — all prompt templates
2. Implement `llmService.ts` — provider classes + generation pipeline
3. Implement `profilerService.ts` — profile building
4. Wire up all LLM-dependent routes (build-profile, generate, refine, plan-metadata)
5. Implement SSE streaming for all streaming endpoints
6. Add skip-thinking support

**Verification:** Build a profile for an existing lyrics set, then generate a new song.

### Phase 3 — Core UI

**Goal:** Navigate Lyric Studio in the CPP app's UI.

1. Port `lireekApi.ts` (API client — mostly copy-paste, already matches the routes)
2. Port core components: `LyricStudio`, `ArtistGrid`, `AlbumGrid`, `AlbumHeader`
3. Port tabs: `SourceLyricsTab`, `ProfilesTab`, `WrittenSongsTab`
4. Port modals: `FetchLyricsModal`, `AddArtistModal`, `AddAlbumModal`
5. Port `ProviderSelector`, `StreamingPanel`
6. Add sidebar nav + App.tsx routing
7. Adapt all styling to TailwindCSS

**Verification:** Full browse → fetch → profile → generate → view flow in the UI.

### Phase 4 — Advanced Features

**Goal:** Feature parity with 9000 integration.

1. Port audio generation integration (`useAudioGeneration` hook, `AudioJobProgress`, `InlineAudioQueue`)
2. Port `PresetSettingsModal` (LoRA adapter presets per album)
3. Port `CuratedProfileModal` (cherry-pick songs across albums for profiling)
4. Port `FloatingPlaylist`, `RecentSongsList`
5. Port `RecordingsTab`
6. Port prompt template editing (`PromptEditor`, `/api/lireek/prompts` routes)

**Verification:** End-to-end: generate lyrics → submit to ace-server for audio → play result.

---

## Risk Assessment

| Risk | Level | Mitigation |
|---|---|---|
| Database schema mismatch | LOW | Schema is defined in code; migrations handle missing columns |
| Genius API scraping breaks | LOW | Same HTTP headers + parsing logic; Genius API is stable |
| LLM provider API changes | LOW | Using stable, versioned API endpoints |
| Prompt quality differs | LOW | Prompts are copied verbatim; same input → same output |
| UI styling inconsistencies | MEDIUM | Incremental Tailwind adaptation; not pixel-perfect initially |
| NLTK syllable counting | LOW | Simple vowel-group algorithm is sufficient for statistics |
| SSE streaming edge cases | LOW | Node.js SSE is simpler than Python's threading approach |
| Total effort underestimated | MEDIUM | Phased approach means each phase is independently useful |

---

## Key Decisions

1. **Separate database file** (`lireek.db`) rather than merging into `hotstep.db` — preserves portability and the ability to share the DB with the standalone Lireek/9000 app.

2. **No provider-specific npm packages** — All LLM calls use `fetch()` against REST APIs. This avoids SDK version churn and keeps the dependency tree small.

3. **`cheerio` for HTML parsing** — Lightweight, well-maintained, and the standard Node.js replacement for BeautifulSoup. Only needed for Genius lyrics scraping.

4. **Prompts copied verbatim** — The prompt engineering is battle-tested in the Python version. Changing prompts would change generation quality. Copy them as-is.

5. **Phase 3 (UI) can start independently** — The API client (`lireekApi.ts`) already defines the exact interface. UI work can proceed in parallel with backend work as long as the CRUD routes from Phase 1 are done.
