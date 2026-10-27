import { usePersonalization } from '../workspace/Personalization';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { userStorage } from '../auth/userStorage';
// useTheme.ts — theme state hook with userStorage persistence
//
// Manages light/dark theme by toggling the `dark` class on <html> and
// updating the <meta name="theme-color"> tag. Defaults to dark mode
// (preserves existing behaviour).

import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'hs-theme';

export type Theme = 'light' | 'dark';

const META_COLORS: Record<Theme, string> = {
  dark: '#000000',
  light: '#fafafa',
};

function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }

  // Update theme-color meta tag
  const meta = document.getElementById('theme-color-meta') as HTMLMetaElement | null;
  if (meta) {
    meta.content = META_COLORS[theme];
  }
}

export function useTheme(): { theme: Theme; toggleTheme: () => void; chooseTheme: (value:Theme)=>void } {
  const personal=usePersonalization();const ws=useWorkspace();
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = userStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* ignore */ }
    return 'dark';
  });

  // Apply theme to DOM on mount + when theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(()=>{if(ws.eligible&&personal.ready&&personal.prefs.theme)setTheme(personal.prefs.theme);},[ws.eligible,personal.ready,personal.prefs.theme]);
  const chooseTheme=useCallback((value:Theme)=>{setTheme(value);userStorage.setItem(STORAGE_KEY,value);if(ws.eligible)void personal.save({theme:value}).catch(()=>{});},[ws.eligible,personal.save]);
  const toggleTheme=useCallback(()=>chooseTheme(theme==='dark'?'light':'dark'),[theme,chooseTheme]);
  return { theme, toggleTheme, chooseTheme };
}
