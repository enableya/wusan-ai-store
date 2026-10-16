import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
const ThemeContext = createContext<{ theme: Theme; setTheme: (value: Theme) => void } | null>(null);

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem('wusan-ai:theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch { return 'system'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(readTheme);
  const setTheme = (value: Theme) => {
    updateTheme(value);
    try { localStorage.setItem('wusan-ai:theme', value); } catch { /* Current-session preference still works. */ }
  };
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('ThemeProvider is required.');
  return value;
}
