import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import type { TextStyle } from 'react-native';

export type AppThemeId =
  | 'purple' | 'olive' | 'navy' | 'champagne' | 'black' | 'silver'
  | 'black-gold' | 'emerald-gold' | 'leopard-red' | 'maroon' | 'gold';

export type AppThemePreset = {
  id: AppThemeId;
  name: string;
  accent: string;
  accentLight: string;
  accentDim: string;
  onAccent: string;
  /** Tonal companion kept for existing gradient consumers; never a separate app accent. */
  secondary: string;
  secondaryDim: string;
  /** Multi-stop premium finish for primary actions and active chrome. */
  primaryGradient: readonly [string, string, ...string[]];
  /** Softer metallic/tonal finish for hero surfaces and progress. */
  heroGradient: readonly [string, string, ...string[]];
  /** Theme-aware ambient glow stops. */
  glowGradient: readonly [string, string, ...string[]];
  shadowColor: string;
};

/** Foreground treatment that stays legible over every primary gradient preset. */
export function getOnAccentTextStyle(theme: AppThemePreset): TextStyle {
  const hex = theme.onAccent.replace('#', '');
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const isLight = (red * 299 + green * 587 + blue * 114) / 1000 >= 128;

  return {
    color: theme.onAccent,
    textShadowColor: isLight ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  };
}

const CANONICAL_ACCENT = '#F7F7FA';
const CANONICAL_ACCENT_LIGHT = '#FFFFFF';
const canonicalPreset = (id: AppThemeId, name: string): AppThemePreset => ({
  id,
  name,
  accent: CANONICAL_ACCENT,
  accentLight: CANONICAL_ACCENT_LIGHT,
  accentDim: 'rgba(255,255,255,0.055)',
  onAccent: '#0A0A0B',
  secondary: CANONICAL_ACCENT,
  secondaryDim: 'rgba(255,255,255,0.055)',
  primaryGradient: [CANONICAL_ACCENT, CANONICAL_ACCENT],
  heroGradient: ['#0A0A0B', '#18181B'],
  glowGradient: ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.01)'],
  shadowColor: '#000000',
});

export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  canonicalPreset('purple', 'Monochrome'),
  canonicalPreset('olive', 'Monochrome'),
  canonicalPreset('navy', 'Monochrome'),
  canonicalPreset('champagne', 'Monochrome'),
  canonicalPreset('black', 'Monochrome'),
  canonicalPreset('silver', 'Monochrome'),
  canonicalPreset('black-gold', 'Monochrome'),
  canonicalPreset('emerald-gold', 'Monochrome'),
  canonicalPreset('leopard-red', 'Monochrome'),
  canonicalPreset('maroon', 'Monochrome'),
  canonicalPreset('gold', 'Monochrome'),
] as const;

export const DEFAULT_THEME = APP_THEME_PRESETS.find((theme) => theme.id === 'purple')!;
const getTheme = (id: unknown): AppThemePreset =>
  typeof id === 'string'
    ? APP_THEME_PRESETS.find((theme) => theme.id === id) ?? DEFAULT_THEME
    : DEFAULT_THEME;
const isThemeId = (id: unknown): id is AppThemeId =>
  typeof id === 'string' && APP_THEME_PRESETS.some((theme) => theme.id === id);
const storageKeyFor = (userId?: string | null) => `@brandthread/app-theme:v1:${userId ?? 'guest'}`;

type ThemeContextValue = {
  theme: AppThemePreset;
  isHydrated: boolean;
  selectTheme: (id: AppThemeId) => Promise<void>;
};

const AppThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  isHydrated: false,
  selectTheme: async () => undefined,
});

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [themeId, setThemeId] = useState<AppThemeId>(DEFAULT_THEME.id);
  const [isHydrated, setIsHydrated] = useState(false);
  const storageKey = storageKeyFor(userId);

  useEffect(() => {
    let active = true;
    setIsHydrated(false);
    setThemeId(DEFAULT_THEME.id);
    AsyncStorage.getItem(storageKey)
      .then((saved) => {
        if (!active || !isThemeId(saved)) return;
        setThemeId(saved);
      })
      .catch(() => {
        // Storage is optional: retain the complete default preset when it is unavailable.
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => { active = false; };
  }, [storageKey]);

  const selectTheme = useCallback(async (id: AppThemeId) => {
    if (!isThemeId(id)) return;
    setThemeId(id);
    try {
      await AsyncStorage.setItem(storageKey, id);
    } catch {
      // Keep the in-memory selection when persistence is unavailable.
    }
  }, [storageKey]);

  const value = useMemo(() => ({ theme: getTheme(themeId), isHydrated, selectTheme }), [isHydrated, selectTheme, themeId]);
  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}