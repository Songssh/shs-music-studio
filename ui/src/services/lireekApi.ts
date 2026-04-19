// lireekApi.ts — Lyric Studio API client
//
// Port of Lireek/frontend/src/api.ts
// Uses raw fetch() (no axios). Routes prefixed /api/lireek/.
// SSE consumer parses named events (event: chunk, event: phase, etc.)

const BASE = '/api/lireek';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  models: string[];
  default_model: string;
}

export interface SongLyrics {
  title: string;
  album: string | null;
  lyrics: string;
}

export interface LyricsProfile {
  artist: string;
  album: string | null;
  themes: string[];
  common_subjects: string[];
  rhyme_schemes: string[];
  avg_verse_lines: number;
  avg_chorus_lines: number;
  vocabulary_notes: string;
  tone_and_mood: string;
  structural_patterns: string;
  additional_notes: string;
  raw_summary: string;
}

export interface SavedArtist {
  id: number;
  name: string;
  created_at: string;
  lyrics_set_count: number;
}

export interface SavedLyricsSetSummary {
  id: number;
  artist_id: number;
  artist_name: string;
  album: string | null;
  max_songs: number;
  total_songs: number;
  fetched_at: string;
}

export interface SavedLyricsSet {
  id: number;
  artist_id: number;
  artist_name: string;
  album: string | null;
  max_songs: number;
  total_songs: number;
  songs: SongLyrics[];
  fetched_at: string;
}

export interface SavedProfile {
  id: number;
  lyrics_set_id: number;
  provider: string;
  model: string;
  profile_data: LyricsProfile;
  created_at: string;
}

export interface SavedGeneration {
  id: number;
  profile_id: number;
  provider: string;
  model: string;
  extra_instructions: string | null;
  title: string;
  subject: string;
  bpm: number;
  key: string;
  caption: string;
  duration: number;
  lyrics: string;
  system_prompt: string;
  user_prompt: string;
  parent_generation_id: number | null;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

// ── SSE Streaming ────────────────────────────────────────────────────────────
// Backend sends: event: <type>\ndata: <json>\n\n
// We parse the event name and dispatch to the right callback.

export interface StreamCallbacks {
  onChunk?: (text: string) => void;
  onPhase?: (phase: string) => void;
  onResult?: (data: any) => void;
  onError?: (message: string) => void;
}

async function consumeSSE(url: string, body: any, callbacks: StreamCallbacks): Promise<void> {
  const resp = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE messages (separated by double newlines)
    const messages = buffer.split('\n\n');
    buffer = messages.pop() || '';

    for (const msg of messages) {
      if (!msg.trim()) continue;

      let eventType = '';
      let eventData = '';

      for (const line of msg.split('\n')) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6).trim();
        }
      }

      if (!eventData) continue;

      try {
        const parsed = JSON.parse(eventData);
        switch (eventType) {
          case 'chunk':
            callbacks.onChunk?.(parsed.text);
            break;
          case 'phase':
            callbacks.onPhase?.(parsed.phase);
            break;
          case 'complete':
            callbacks.onResult?.(parsed);
            break;
          case 'error':
            callbacks.onError?.(parsed.error || parsed.message || 'Unknown error');
            break;
          default:
            // Fallback: try inline type field for compatibility
            if (parsed.type === 'chunk') callbacks.onChunk?.(parsed.text);
            else if (parsed.type === 'phase') callbacks.onPhase?.(parsed.text);
            else if (parsed.type === 'result') callbacks.onResult?.(parsed.data);
            else if (parsed.type === 'error') callbacks.onError?.(parsed.message);
            break;
        }
      } catch { /* skip malformed lines */ }
    }
  }
}

// ── API Functions ────────────────────────────────────────────────────────────

// Providers
export const getProviders = (): Promise<ProviderInfo[]> =>
  get('/providers');

// Fetch lyrics from Genius & save
export const fetchAndSave = (req: {
  artist: string;
  album?: string;
  max_songs: number;
}): Promise<SavedLyricsSetSummary> =>
  post('/fetch-and-save', req);

// Artists
export const getArtists = (): Promise<SavedArtist[]> =>
  get('/artists');

export const deleteArtist = (id: number): Promise<void> =>
  del(`/artists/${id}`);

// Lyrics sets
export const getArtistLyricsSets = (artistId: number): Promise<SavedLyricsSetSummary[]> =>
  get(`/artists/${artistId}/lyrics-sets`);

export const getLyricsSet = (id: number): Promise<SavedLyricsSet> =>
  get(`/lyrics-sets/${id}`);

export const deleteLyricsSet = (id: number): Promise<void> =>
  del(`/lyrics-sets/${id}`);

export const removeSong = (lyricsSetId: number, songIndex: number): Promise<SavedLyricsSet> =>
  del(`/lyrics-sets/${lyricsSetId}/songs/${songIndex}`);

export const editSong = (lyricsSetId: number, songIndex: number, newLyrics: string): Promise<SavedLyricsSet> =>
  put(`/lyrics-sets/${lyricsSetId}/songs/${songIndex}`, { lyrics: newLyrics });

export const addSong = (lyricsSetId: number, song: { title: string; album?: string; lyrics: string }): Promise<SavedLyricsSet> =>
  post(`/lyrics-sets/${lyricsSetId}/songs`, song);

// Profiles
export const buildProfile = (lyricsSetId: number, req: {
  provider_name: string;
  model?: string;
}): Promise<SavedProfile> =>
  post(`/lyrics-sets/${lyricsSetId}/build-profile`, req);

export const getLyricsSetProfiles = (lyricsSetId: number): Promise<SavedProfile[]> =>
  get(`/profiles?lyrics_set_id=${lyricsSetId}`);

export const getProfile = (id: number): Promise<SavedProfile> =>
  get(`/profiles/${id}`);

export const deleteProfile = (id: number): Promise<void> =>
  del(`/profiles/${id}`);

// Generations
export const generateFromProfile = (profileId: number, req: {
  provider_name: string;
  model?: string;
  extra_instructions?: string;
}): Promise<SavedGeneration> =>
  post(`/profiles/${profileId}/generate`, req);

export const getProfileGenerations = (profileId: number): Promise<SavedGeneration[]> =>
  get(`/generations?profile_id=${profileId}`);

export const getLyricsSetGenerations = (lyricsSetId: number): Promise<SavedGeneration[]> =>
  get(`/generations?lyrics_set_id=${lyricsSetId}`);

export const getGeneration = (id: number): Promise<SavedGeneration> =>
  get(`/generations/${id}`);

export const deleteGeneration = (id: number): Promise<void> =>
  del(`/generations/${id}`);

// Export
export const exportGeneration = (id: number): Promise<{ status: string; path: string }> =>
  post(`/generations/${id}/export`);

export const exportAllGenerations = (): Promise<{ status: string; exported: number; backfilled: number; errors: number }> =>
  post('/export-all');

// Skip thinking
export const skipThinking = (): Promise<void> =>
  post('/skip-thinking');

// SSE Streaming
export const streamBuildProfile = (
  lyricsSetId: number,
  req: { provider_name: string; model?: string },
  callbacks: StreamCallbacks,
): Promise<void> =>
  consumeSSE(`/lyrics-sets/${lyricsSetId}/build-profile-stream`, req, callbacks);

export const streamGenerateFromProfile = (
  profileId: number,
  req: { provider_name: string; model?: string; extra_instructions?: string },
  callbacks: StreamCallbacks,
): Promise<void> =>
  consumeSSE(`/profiles/${profileId}/generate-stream`, req, callbacks);

export const streamRefineGeneration = (
  generationId: number,
  req: { provider_name: string; model?: string },
  callbacks: StreamCallbacks,
): Promise<void> =>
  consumeSSE(`/generations/${generationId}/refine-stream`, req, callbacks);

// ── Settings ─────────────────────────────────────────────────────────────────

export interface LireekSettings {
  generationProvider: string;
  generationModel: string;
  refinementProvider: string;
  refinementModel: string;
  profilingProvider: string;
  profilingModel: string;
}

const SETTINGS_KEY = 'lireek-settings';

const DEFAULT_SETTINGS: LireekSettings = {
  generationProvider: 'gemini',
  generationModel: '',
  refinementProvider: 'gemini',
  refinementModel: '',
  profilingProvider: 'gemini',
  profilingModel: '',
};

export function loadSettings(): LireekSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: LireekSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
