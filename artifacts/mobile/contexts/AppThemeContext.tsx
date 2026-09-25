import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { Platform, type TextStyle } from 'react-native';
import { useApi } from '@/lib/api';

export type AppThemeId =
  | 'monochrome' | 'purple' | 'olive' | 'navy' | 'champagne' | 'black' | 'silver'
  | 'black-gold' | 'emerald-gold' | 'leopard-red' | 'maroon' | 'gold';

export type AppThemePreset = {
  id: AppThemeId; name: string;
  background: string; surface: string; card: string; cardElevated: string;
  surfaceGlass: string; cardGlass: string; cardElevatedGlass: string;
  border: string; borderSubtle: string; text: string; muted: string; subtle: string;
  accent: string; accentLight: string; accentDim: string; onAccent: string;
  secondary: string; secondaryDim: string;
  primaryGradient: readonly [string, string, ...string[]];
  heroGradient: readonly [string, string, ...string[]];
  glowGradient: readonly [string, string, ...string[]];
  tabBarBackground: string; success: string; warning: string; error: string;
  shadowColor: string;
};

export function getOnAccentTextStyle(theme: AppThemePreset): TextStyle {
  return { color: theme.onAccent, textShadowColor: '#00000055', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 };
}

type Palette = Omit<AppThemePreset, 'id' | 'name'>;
const palette = (
  background: string, surface: string, card: string, accent: string, onAccent: string,
  primaryGradient: readonly [string, string, ...string[]],
  heroGradient: readonly [string, string, ...string[]],
  glowGradient: readonly [string, string, ...string[]],
  status: Pick<AppThemePreset, 'success' | 'warning' | 'error'>,
): Palette => ({
  background, surface, card, cardElevated: card,
  surfaceGlass: `${surface}E8`, cardGlass: `${card}E8`, cardElevatedGlass: `${card}F2`,
  border: '#FFFFFF2B', borderSubtle: '#FFFFFF1A',
  text: '#FAFAFA', muted: '#B8B8C0', subtle: '#A8A8B1',
  accent, accentLight: accent, accentDim: `${accent}2E`, onAccent,
  secondary: accent, secondaryDim: `${accent}24`,
  primaryGradient, heroGradient, glowGradient, tabBarBackground: `${background}F5`,
  ...status, shadowColor: '#000000',
});
const STATUS = { success: '#7FF0B0', warning: '#FFD580', error: '#FFB4B4' } as const;
const MONOCHROME = palette('#0A0A0B', '#111113', '#18181B', '#F7F7FA', '#0A0A0B', ['#F7F7FA', '#FFFFFF'], ['#0A0A0B', '#18181B'], ['#FFFFFF0F', '#FFFFFF03'], STATUS);
const PRESET_PALETTES: Record<Exclude<AppThemeId, 'monochrome'>, Palette> = {
  purple: palette('#281235', '#321844', '#3B1B4B', '#D990FF', '#190A24', ['#A24EDD', '#D990FF'], ['#281235', '#5A2670'], ['#A24EDD44', '#A24EDD0A'], STATUS),
  olive: palette('#2C311E', '#353B25', '#3B4129', '#C9D8A7', '#1C2113', ['#8D9B70', '#C9D8A7'], ['#2C311E', '#59633B'], ['#A5B38844', '#A5B3880A'], STATUS),
  navy: palette('#09142F', '#0C1A3D', '#10234C', '#78A8FF', '#071025', ['#235EDE', '#78A8FF'], ['#09142F', '#173E84'], ['#235EDE44', '#235EDE0A'], STATUS),
  champagne: palette('#2A211A', '#382A1D', '#473522', '#F2C78C', '#21150B', ['#B88145', '#F2C78C'], ['#2A211A', '#664524'], ['#D6A65644', '#D6A6560A'], STATUS),
  black: palette('#171717', '#202020', '#292929', '#E5E5E5', '#111111', ['#9F9E9E', '#E5E5E5'], ['#171717', '#363636'], ['#FFFFFF26', '#FFFFFF05'], STATUS),
  silver: palette('#25272A', '#303236', '#3B3E43', '#E7E7E7', '#111214', ['#A6A5A5', '#E7E7E7'], ['#25272A', '#50545A'], ['#FFFFFF2E', '#FFFFFF06'], STATUS),
  'black-gold': palette('#0C0C0C', '#141414', '#1D1D1D', '#F0C36B', '#211505', ['#A9782D', '#F0C36B'], ['#0C0C0C', '#453C2E'], ['#D6A65644', '#D6A6560A'], STATUS),
  'emerald-gold': palette('#182411', '#25351A', '#304421', '#F0C66F', '#211604', ['#977029', '#F0C66F'], ['#182411', '#473915'], ['#D3A85444', '#D3A8540A'], STATUS),
  'leopard-red': palette('#4A080D', '#5C0C12', '#70131A', '#F0C36B', '#211505', ['#A70807', '#F0C36B'], ['#4A080D', '#70131A'], ['#DC0F0D44', '#DC0F0D0A'], { success: '#A7FFBE', warning: '#FFE29A', error: '#FFD0D0' }),
  maroon: palette('#310711', '#460A18', '#5A1022', '#FF7B82', '#31030A', ['#B51F32', '#FF7B82'], ['#310711', '#5A1022'], ['#ED394544', '#ED39450A'], { success: '#A7FFBE', warning: '#FFE29A', error: '#FFD0D0' }),
  gold: palette('#241A0D', '#382710', '#4B3416', '#FFD27A', '#211303', ['#B67E2E', '#FFD27A'], ['#241A0D', '#725124'], ['#EFC57744', '#EFC5770A'], STATUS),
};
const makePreset = (id: AppThemeId, name: string, colors: Palette): AppThemePreset => ({ id, name, ...colors });
export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  makePreset('monochrome', 'Monochrome', MONOCHROME),
  makePreset('purple', 'Purple', PRESET_PALETTES.purple),
  makePreset('olive', 'Olive', PRESET_PALETTES.olive),
  makePreset('navy', 'Navy', PRESET_PALETTES.navy),
  makePreset('champagne', 'Champagne', PRESET_PALETTES.champagne),
  makePreset('black', 'Black', PRESET_PALETTES.black),
  makePreset('silver', 'Silver', PRESET_PALETTES.silver),
  makePreset('black-gold', 'Black & Gold', PRESET_PALETTES['black-gold']),
  makePreset('emerald-gold', 'Emerald & Gold', PRESET_PALETTES['emerald-gold']),
  makePreset('leopard-red', 'Leopard Red', PRESET_PALETTES['leopard-red']),
  makePreset('maroon', 'Maroon', PRESET_PALETTES.maroon),
  makePreset('gold', 'Gold', PRESET_PALETTES.gold),
] as const;
export const DEFAULT_THEME = APP_THEME_PRESETS[0];
const getTheme = (id: unknown) => APP_THEME_PRESETS.find((theme) => theme.id === id) ?? DEFAULT_THEME;
const isThemeId = (id: unknown): id is AppThemeId => typeof id === 'string' && APP_THEME_PRESETS.some((theme) => theme.id === id);
const THEME_STORAGE_PREFIX = '@brandthread/app-theme:v1:';
const storageKeyFor = (userId?: string | null) => `${THEME_STORAGE_PREFIX}${userId ?? 'guest'}`;

export interface ThemePeekStorage {
  getItem(key: string): Promise<string | null>;
  getAllKeys?(): Promise<readonly string[]>;
}

/**
 * Best-effort read of the last-persisted theme, for code that must render
 * before `AppThemeProvider` (and therefore `useAuth()`) exists — namely the
 * launch intro, which wraps the whole provider tree so it can hand off to
 * the native splash before anything else has mounted. Falls back to
 * `DEFAULT_THEME` whenever nothing usable is found or storage throws.
 */
export async function peekPersistedTheme(storage: ThemePeekStorage): Promise<AppThemePreset> {
  try {
    if (storage.getAllKeys) {
      const keys = await storage.getAllKeys();
      const userKey = keys.find((key) => key.startsWith(THEME_STORAGE_PREFIX) && key !== storageKeyFor(null));
      if (userKey) {
        const value = await storage.getItem(userKey);
        if (isThemeId(value)) return getTheme(value);
      }
    }
    const guestValue = await storage.getItem(storageKeyFor(null));
    if (isThemeId(guestValue)) return getTheme(guestValue);
  } catch {
    // Best effort only — the splash still needs to render something.
  }
  return DEFAULT_THEME;
}

const getPreviewThemeId = (): AppThemeId | null => {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const requested = new URLSearchParams(window.location.search).get('bt_theme');
  return isThemeId(requested) ? requested : null;
};

type ThemeContextValue = { theme: AppThemePreset; isHydrated: boolean; selectTheme: (id: AppThemeId) => Promise<void> };
const AppThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_THEME, isHydrated: false, selectTheme: async () => undefined });

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const api = useApi();
  const [themeId, setThemeId] = useState<AppThemeId>(DEFAULT_THEME.id);
  const [isHydrated, setIsHydrated] = useState(false);
  const selectionVersionRef = useRef(0);
  const storageKey = storageKeyFor(userId);
  useEffect(() => {
    let active = true;
    const reconciliationVersion = selectionVersionRef.current;
    setIsHydrated(false);
    const previewThemeId = getPreviewThemeId();
    if (previewThemeId) {
      setThemeId(previewThemeId);
      setIsHydrated(true);
      return () => { active = false; };
    }

    void (async () => {
      let saved: string | null = null;
      try {
        saved = await AsyncStorage.getItem(storageKey);
      } catch {
        // A storage failure must not keep the app behind the boot screen.
      }

      if (!active) return;
      const localThemeId = isThemeId(saved) ? saved : DEFAULT_THEME.id;
      setThemeId((current) => current === localThemeId ? current : localThemeId);
      setIsHydrated(true);

      try {
        const profile: any = await api.auth.me();
        if (!active || reconciliationVersion !== selectionVersionRef.current) return;
        if (!isThemeId(profile?.appThemeId)) return;
        const serverThemeId = profile.appThemeId;
        if (serverThemeId !== localThemeId) setThemeId(serverThemeId);
        if (serverThemeId !== saved) void AsyncStorage.setItem(storageKey, serverThemeId);
      } catch {
        // The locally saved theme remains authoritative while offline.
      }
    })();

    return () => { active = false; };
  }, [api, storageKey]);
  const selectTheme = useCallback(async (id: AppThemeId) => {
    if (!isThemeId(id)) return;
    selectionVersionRef.current += 1;
    setThemeId(id);
    try {
      await AsyncStorage.setItem(storageKey, id);
      await api.auth.updateProfile({ appThemeId: id });
    } catch {
      // Local state/storage remain authoritative while offline.
    }
  }, [api, storageKey]);
  const value = useMemo(() => ({ theme: getTheme(themeId), isHydrated, selectTheme }), [isHydrated, selectTheme, themeId]);
  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}
export function useAppTheme() { return useContext(AppThemeContext); }