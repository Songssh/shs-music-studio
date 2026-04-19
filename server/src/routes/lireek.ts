// lireek.ts — Express routes for Lyric Studio / Lireek
//
// All endpoints under /api/lireek/*
// Phase 1: CRUD routes for artists, lyrics sets, profiles, generations
// Phase 2: LLM-powered routes (build-profile, generate, refine) — TODO

import { Router, type Request, type Response } from 'express';
import * as db from '../db/lireekDb.js';
import * as genius from '../services/lireek/geniusService.js';
import { exportGeneration } from '../services/lireek/exportService.js';
import { scanForSlop, BLACKLISTED_WORDS, BLACKLISTED_PHRASES } from '../services/lireek/slopDetector.js';

const router = Router();

/** Safely extract a route param as string (Express 5 types params as string | string[]) */
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Parse an integer route param */
function intParam(req: Request, name: string): number {
  return parseInt(param(req, name), 10);
}

// ── Artists ─────────────────────────────────────────────────────────────────

router.get('/artists', (_req: Request, res: Response) => {
  try {
    const artists = db.listArtists();
    res.json(artists);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/artists/create', (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: 'Artist name required' });
      return;
    }
    const artist = db.getOrCreateArtist(name.trim());
    res.json(artist);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/artists/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const deleted = db.deleteArtist(id);
    if (!deleted) { res.status(404).json({ error: 'Artist not found' }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/artists/:id/refresh-image', async (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const artist = db.getArtist(id);
    if (!artist) { res.status(404).json({ error: 'Artist not found' }); return; }
    const imageUrl = await genius.getArtistImageUrl(artist.name);
    if (imageUrl) db.updateArtistImage(id, imageUrl);
    res.json({ image_url: imageUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/artists/:id/set-image', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const { image_url } = req.body;
    db.updateArtistImage(id, image_url ?? null);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Lyrics Sets ─────────────────────────────────────────────────────────────

router.get('/lyrics-sets', (req: Request, res: Response) => {
  try {
    const artistId = req.query.artist_id ? parseInt(req.query.artist_id as string, 10) : undefined;
    const sets = db.getLyricsSets(artistId);
    res.json(sets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lyrics-sets/create', (req: Request, res: Response) => {
  try {
    const { artist_name, album, songs } = req.body;
    if (!artist_name?.trim() || !Array.isArray(songs)) {
      res.status(400).json({ error: 'artist_name and songs array required' });
      return;
    }
    const artist = db.getOrCreateArtist(artist_name.trim());
    const set = db.saveLyricsSet(artist.id as number, album ?? null, songs.length, songs);
    res.json(set);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/lyrics-sets/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const set = db.getLyricsSet(id);
    if (!set) { res.status(404).json({ error: 'Lyrics set not found' }); return; }
    res.json(set);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/lyrics-sets/:id/full-detail', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const set = db.getLyricsSet(id);
    if (!set) { res.status(404).json({ error: 'Lyrics set not found' }); return; }
    const profiles = db.getProfiles(id);
    const generations = db.getGenerations(undefined, id);
    const preset = db.getPreset(id);
    res.json({ ...set, profiles, generations, preset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/lyrics-sets/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const deleted = db.deleteLyricsSet(id);
    if (!deleted) { res.status(404).json({ error: 'Lyrics set not found' }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/lyrics-sets/:id/songs/:index', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const index = intParam(req, 'index');
    const updated = db.removeSongFromSet(id, index);
    if (!updated) { res.status(404).json({ error: 'Song not found' }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/lyrics-sets/:id/songs/:index', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const index = intParam(req, 'index');
    const { lyrics } = req.body;
    const updated = db.editSongInSet(id, index, lyrics);
    if (!updated) { res.status(404).json({ error: 'Song not found' }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lyrics-sets/:id/refresh-image', async (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const set = db.getLyricsSet(id);
    if (!set) { res.status(404).json({ error: 'Lyrics set not found' }); return; }
    const imageUrl = set.album
      ? await genius.getAlbumImageUrl(set.album, set.artist_name)
      : await genius.getArtistImageUrl(set.artist_name);
    if (imageUrl) db.updateLyricsSetImage(id, imageUrl);
    res.json({ image_url: imageUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lyrics-sets/:id/set-image', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const { image_url } = req.body;
    db.updateLyricsSetImage(id, image_url ?? null);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lyrics-sets/:id/add-song', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const { title, album, lyrics } = req.body;
    if (!title || !lyrics) {
      res.status(400).json({ error: 'title and lyrics required' });
      return;
    }
    const updated = db.addSongToSet(id, { title, album, lyrics });
    if (!updated) { res.status(404).json({ error: 'Lyrics set not found' }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fetch Lyrics (Genius) ───────────────────────────────────────────────────

router.post('/fetch-lyrics', async (req: Request, res: Response) => {
  try {
    const { artist, album, max_songs = 10 } = req.body;
    if (!artist?.trim()) {
      res.status(400).json({ error: 'Artist name required' });
      return;
    }

    const result = await genius.fetchLyrics(artist.trim(), album?.trim() || null, max_songs);

    // Save to database
    const artistRow = db.getOrCreateArtist(result.artist);

    // Try to get artist image if we don't have one
    if (!artistRow.image_url) {
      genius.getArtistImageUrl(result.artist).then(url => {
        if (url) db.updateArtistImage(artistRow.id as number, url);
      }).catch(() => {});
    }

    // Try to get album image
    let albumImageUrl: string | null = null;
    if (result.album) {
      try {
        albumImageUrl = await genius.getAlbumImageUrl(result.album, result.artist);
      } catch {}
    }

    const lyricsSet = db.saveLyricsSet(
      artistRow.id as number,
      result.album,
      result.songs.length,
      result.songs,
      albumImageUrl,
    );

    res.json({
      ...result,
      artist_id: artistRow.id,
      lyrics_set_id: lyricsSet.id,
    });
  } catch (err: any) {
    const status = err.message?.includes('not found') || err.message?.includes('No lyrics') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/search-song-lyrics', async (req: Request, res: Response) => {
  try {
    const { artist, title } = req.body;
    if (!artist || !title) {
      res.status(400).json({ error: 'artist and title required' });
      return;
    }
    const result = await genius.searchSongLyrics(artist, title);
    if (!result) { res.status(404).json({ error: 'Song not found' }); return; }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Profiles ────────────────────────────────────────────────────────────────

router.get('/profiles', (req: Request, res: Response) => {
  try {
    const lyricsSetId = req.query.lyrics_set_id ? parseInt(req.query.lyrics_set_id as string, 10) : undefined;
    res.json(db.getProfiles(lyricsSetId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/profiles/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const profile = db.getProfile(id);
    if (!profile) { res.status(404).json({ error: 'Profile not found' }); return; }
    res.json(profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/profiles/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const deleted = db.deleteProfile(id);
    if (!deleted) { res.status(404).json({ error: 'Profile not found' }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generations ─────────────────────────────────────────────────────────────

router.get('/generations', (req: Request, res: Response) => {
  try {
    const profileId = req.query.profile_id ? parseInt(req.query.profile_id as string, 10) : undefined;
    const lyricsSetId = req.query.lyrics_set_id ? parseInt(req.query.lyrics_set_id as string, 10) : undefined;
    res.json(db.getGenerations(profileId, lyricsSetId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/generations/all', (_req: Request, res: Response) => {
  try {
    res.json(db.getAllGenerationsWithContext());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/generations/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const gen = db.getGeneration(id);
    if (!gen) { res.status(404).json({ error: 'Generation not found' }); return; }
    res.json(gen);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/generations/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    db.updateGenerationFields(id, req.body);
    const updated = db.getGeneration(id);
    if (!updated) { res.status(404).json({ error: 'Generation not found' }); return; }
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/generations/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const deleted = db.deleteGeneration(id);
    if (!deleted) { res.status(404).json({ error: 'Generation not found' }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Export ───────────────────────────────────────────────────────────────────

router.post('/generations/:id/export', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const gen = db.getGeneration(id);
    if (!gen) { res.status(404).json({ error: 'Generation not found' }); return; }

    // Get context (artist name, album)
    const profile = db.getProfile(gen.profile_id);
    let artistName = 'Unknown';
    let albumName: string | undefined;
    if (profile) {
      const lyricsSet = db.getLyricsSet(profile.lyrics_set_id);
      if (lyricsSet) {
        artistName = lyricsSet.artist_name;
        albumName = lyricsSet.album ?? undefined;
      }
    }

    const paths = exportGeneration({
      title: gen.title,
      lyrics: gen.lyrics,
      artistName,
      albumName,
      provider: gen.provider,
      model: gen.model,
      bpm: gen.bpm,
      key: gen.key,
      caption: gen.caption,
      duration: gen.duration,
      subject: gen.subject,
      extraInstructions: gen.extra_instructions,
      createdAt: gen.created_at,
    });
    res.json({ success: true, ...paths });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Audio Generations ───────────────────────────────────────────────────────

router.post('/generations/:id/audio', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const { job_id } = req.body;
    if (!job_id) { res.status(400).json({ error: 'job_id required' }); return; }
    const link = db.linkAudioGeneration(id, job_id);
    res.json(link);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/generations/:id/audio', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    res.json(db.getAudioGenerations(id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/audio-generations/:id', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const deleted = db.deleteAudioGeneration(id);
    if (!deleted) { res.status(404).json({ error: 'Audio generation not found' }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/audio-generations/resolve', (req: Request, res: Response) => {
  try {
    const { job_id, audio_url, cover_url } = req.body;
    if (!job_id || !audio_url) { res.status(400).json({ error: 'job_id and audio_url required' }); return; }
    db.resolveAudioGeneration(job_id, audio_url, cover_url);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Album Presets ───────────────────────────────────────────────────────────

router.get('/lyrics-sets/:id/preset', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const preset = db.getPreset(id);
    res.json(preset ?? null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/lyrics-sets/:id/preset', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    const preset = db.upsertPreset(id, {
      adapterPath: req.body.adapter_path,
      adapterScale: req.body.adapter_scale,
      adapterGroupScales: req.body.adapter_group_scales,
      referenceTrackPath: req.body.reference_track_path,
      audioCoverStrength: req.body.audio_cover_strength,
    });
    res.json(preset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/lyrics-sets/:id/preset', (req: Request, res: Response) => {
  try {
    const id = intParam(req, 'id');
    db.deletePreset(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/presets', (_req: Request, res: Response) => {
  try {
    res.json(db.getAllPresets());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Slop Scanner ────────────────────────────────────────────────────────────

router.post('/slop-scan', (req: Request, res: Response) => {
  try {
    const { text, fingerprint, statistical_weight } = req.body;
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const result = scanForSlop(text, fingerprint, statistical_weight);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Purge ───────────────────────────────────────────────────────────────────

router.post('/purge', (_req: Request, res: Response) => {
  try {
    const result = db.purgeProfilesAndGenerations();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings / Prompts ──────────────────────────────────────────────────────

router.get('/prompts', (_req: Request, res: Response) => {
  // Return list of customizable prompt names with current values
  const names = ['generation_system', 'metadata_system', 'profile_system', 'refine_system'];
  const prompts = names.map(name => ({
    name,
    custom: db.getSetting(`prompt_${name}`) || null,
  }));
  res.json(prompts);
});

router.put('/prompts/:name', (req: Request, res: Response) => {
  try {
    const promptName = param(req, 'name');
    const { value } = req.body;
    if (!value) { res.status(400).json({ error: 'value required' }); return; }
    db.setSetting(`prompt_${promptName}`, value);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/prompts/:name', (req: Request, res: Response) => {
  try {
    const promptName = param(req, 'name');
    db.setSetting(`prompt_${promptName}`, '');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recent Songs ────────────────────────────────────────────────────────────

router.get('/recent-songs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    res.json(db.getRecentGenerationsWithAudio(limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── LLM Providers (Phase 2 — stub for now) ──────────────────────────────────

router.get('/providers', (_req: Request, res: Response) => {
  // TODO: Phase 2 — list available LLM providers
  res.json([]);
});

// ── Build Profile (Phase 2 — stub) ──────────────────────────────────────────

router.post('/lyrics-sets/:id/build-profile', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Profile building not yet implemented (Phase 2)' });
});

router.post('/lyrics-sets/:id/build-profile-stream', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Profile building not yet implemented (Phase 2)' });
});

// ── Generate Lyrics (Phase 2 — stub) ────────────────────────────────────────

router.post('/profiles/:id/generate', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Lyric generation not yet implemented (Phase 2)' });
});

router.post('/profiles/:id/generate-stream', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Lyric generation not yet implemented (Phase 2)' });
});

// ── Refine Lyrics (Phase 2 — stub) ──────────────────────────────────────────

router.post('/generations/:id/refine', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Lyric refinement not yet implemented (Phase 2)' });
});

router.post('/generations/:id/refine-stream', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Lyric refinement not yet implemented (Phase 2)' });
});

// ── Curated Profile (Phase 2 — stub) ────────────────────────────────────────

router.post('/artists/:id/curated-profile', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Curated profiles not yet implemented (Phase 2)' });
});

router.post('/artists/:id/curated-profile-stream', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Curated profiles not yet implemented (Phase 2)' });
});

// ── Skip Thinking (Phase 2 — stub) ──────────────────────────────────────────

router.post('/skip-thinking', (_req: Request, res: Response) => {
  res.json({ success: true });
});

export default router;
