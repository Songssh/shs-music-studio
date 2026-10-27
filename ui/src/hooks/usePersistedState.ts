import { userStorage } from '../auth/userStorage';
// usePersistedState.ts — useState with userStorage persistence
//
// Drop-in replacement for useState that survives page refreshes.
// Also listens for external storage writes (e.g. from queue stores)
// so the top bar stays in sync with Lyric Studio's adapter changes.

import { useState, useEffect, useCallback, useRef } from 'react';

export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = userStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const current = useRef(state);
  current.current = state;
  // Commit at the input boundary, before an Activity can hide its effects.
  // A later reveal must also see Auto→Custom / Assistant writes made while hidden.
  const persist = useCallback((value: T | ((prev: T) => T)) => {
    const next = typeof value === 'function' ? (value as (prev: T) => T)(current.current) : value;
    current.current = next;
    try { userStorage.setItem(key, JSON.stringify(next)); } catch { /* Storage unavailable */ }
    setState(next);
  }, [key]);

  // Listen for writes from other tabs or from non-React code (queue stores)
  useEffect(() => {
    try {
      const value = userStorage.getItem(key);
      if (value !== null) { current.current = JSON.parse(value); setState(current.current); }
      else userStorage.setItem(key, JSON.stringify(current.current));
    } catch { /* Storage unavailable */ }
    const handler = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try { current.current = JSON.parse(e.newValue); setState(current.current); } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  return [state, persist];
}

/** Write a value to userStorage AND dispatch a StorageEvent so
 *  usePersistedState hooks in the same tab pick up the change. */
export function writePersistedState(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  const oldValue = userStorage.getItem(key);
  userStorage.setItem(key, serialized);
  // StorageEvent only fires cross-tab; dispatch manually for same-tab listeners
  window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: serialized }));
}
