import React, { createContext, useContext, useMemo, useState } from 'react';
import { dark, light, Theme } from '../theme';

type ThemeContextValue = {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setDark] = useState(true);
  const value = useMemo(
    () => ({ theme: isDark ? dark : light, isDark, toggleTheme: () => setDark(v => !v) }),
    [isDark]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
