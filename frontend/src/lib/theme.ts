import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'warden-tracker.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'system' ? saved : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Theme choice persisted per browser; dark unless chosen otherwise, "system" follows the OS live. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    apply(theme);
    if (theme !== 'system') return;
    const query = media();
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === 'dark') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable - the choice lasts for this page view only
    }
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
