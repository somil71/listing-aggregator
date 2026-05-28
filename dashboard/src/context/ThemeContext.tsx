/**
 * ThemeContext — single source of truth for dark/light mode.
 *
 * We deliberately call applyDark() synchronously inside the state initialiser
 * so the very first render already has the correct class on <html>.
 * The inline <script> in index.html does the same before React loads, so
 * there is no Flash Of Unstyled Content (FOUC) at any stage.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'propdigest-theme';

function applyDark(dark: boolean) {
  const root = document.documentElement;
  if (dark) root.classList.add('dark');
  else root.classList.remove('dark');
}

function getInitial(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    const dark = stored !== null
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    // Apply synchronously so the first paint is already correct
    applyDark(dark);
    return dark;
  } catch {
    return false;
  }
}

interface ThemeCtx { dark: boolean; toggle: () => void; }

const ThemeContext = createContext<ThemeCtx>({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // getInitial both reads the preference AND applies the class synchronously
  const [dark, setDark] = useState<boolean>(getInitial);

  useEffect(() => {
    applyDark(dark);
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  const toggle = () => setDark(d => !d);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Single source of truth for dark mode across the entire app. */
export function useTheme() { return useContext(ThemeContext); }
