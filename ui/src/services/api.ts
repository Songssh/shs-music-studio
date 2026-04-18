// api.ts — Frontend API client
//
// Thin wrapper around fetch() for all server endpoints.
// Each method is standalone — import only what you need.

import type { Song, GenerationParams, GenerationJob, AuthState, AceModels } from '../types';

const BASE = '/api';

async function get<T>(path: string, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function patch<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function del<T>(path: string, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

// ── Auth ────────────────────────────────────────────────────
export const authApi = {
  autoLogin: () => get<AuthState>('/auth/auto'),
  getMe: (token: string) => get<{ user: AuthState['user'] }>('/auth/me', token),
  updateUsername: (username: string, token: string) =>
    patch<AuthState>('/auth/username', { username }, token),
};

// ── Song Normalizer ─────────────────────────────────────────
/** Map DB snake_case fields to camelCase for component consumption */
function normalizeSong(s: any): Song {
  const gp = (() => {
    if (s.generationParams) return s.generationParams;
    if (s.generation_params) {
      return typeof s.generation_params === 'string'
        ? JSON.parse(s.generation_params) : s.generation_params;
    }
    return undefined;
  })();

  return {
    id: s.id,
    title: s.title || '',
    lyrics: s.lyrics || '',
    style: s.style || '',
    caption: s.caption || s.style || '',
    audioUrl: s.audio_url || s.audioUrl || '',
    audio_url: s.audio_url,
    coverUrl: s.cover_url || s.coverUrl,
    cover_url: s.cover_url,
    duration: s.duration || 0,
    bpm: s.bpm || gp?.bpm,
    key_scale: s.key_scale,
    time_signature: s.time_signature,
    tags: s.tags || [],
    is_public: s.is_public,
    dit_model: s.dit_model,
    generation_params: s.generation_params,
    generationParams: gp,
    created_at: s.created_at,
    createdAt: s.created_at ? new Date(s.created_at) : undefined,
  };
}

// ── Songs ────────────────────────────────────────────────────
export const songApi = {
  list: async (token: string) => {
    const data = await get<{ songs: any[] }>('/songs', token);
    return { songs: data.songs.map(normalizeSong) };
  },
  get: async (id: string) => {
    const data = await get<{ song: any }>(`/songs/${id}`);
    return { song: normalizeSong(data.song) };
  },
  create: (song: Partial<Song>, token: string) => post<{ song: Song }>('/songs', song, token),
  update: (id: string, data: Partial<Song>, token: string) =>
    patch<{ song: Song }>(`/songs/${id}`, data, token),
  delete: (id: string, token: string) => del<{ success: boolean }>(`/songs/${id}`, token),
  deleteAll: (token: string) => del<{ success: boolean; deletedCount: number }>('/songs', token),
};

// ── Generation ──────────────────────────────────────────────
export const generateApi = {
  submit: (params: GenerationParams, token: string) =>
    post<{ jobId: string; status: string }>('/generate', params, token),
  status: (jobId: string) => get<GenerationJob>(`/generate/status/${jobId}`),
  cancel: (jobId: string) => post<{ success: boolean }>(`/generate/cancel/${jobId}`),
  cancelAll: () => post<{ success: boolean; cancelled: number }>('/generate/cancel-all'),
};

// ── Models ──────────────────────────────────────────────────
export const modelApi = {
  list: () => get<AceModels>('/models'),
  health: () => get<{ aceServer: string }>('/models/health'),
};

// ── Health ──────────────────────────────────────────────────
export const healthApi = {
  check: () => get<{
    status: string;
    aceServer: { status: string; url: string; version: string };
    server: { port: number; uptime: number };
  }>('/health'),
};

// ── Shutdown ────────────────────────────────────────────────
export const shutdownApi = {
  quit: () => post<{ success: boolean; message: string }>('/shutdown'),
};

