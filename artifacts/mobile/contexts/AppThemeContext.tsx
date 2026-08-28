import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';

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

export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  { id: 'purple', name: 'Purple', accent: '#8B5CF6', accentLight: '#A78BFA', accentDim: 'rgba(139,92,246,0.18)', onAccent: '#FFFFFF', secondary: '#A78BFA', secondaryDim: 'rgba(139,92,246,0.10)', primaryGradient: ['#6D28D9', '#8B5CF6', '#A78BFA'], heroGradient: ['#4C1D95', '#8B5CF6', '#A78BFA'], glowGradient: ['rgba(139,92,246,0.24)', 'rgba(167,139,250,0.04)'], shadowColor: '#8B5CF6' },
  { id: 'olive', name: 'Olive', accent: '#71823C', accentLight: '#ADBE73', accentDim: 'rgba(113,130,60,0.20)', onAccent: '#FFFFFF', secondary: '#ADBE73', secondaryDim: 'rgba(113,130,60,0.11)', primaryGradient: ['#465326', '#71823C', '#ADBE73'], heroGradient: ['#30391D', '#71823C', '#ADBE73'], glowGradient: ['rgba(113,130,60,0.24)', 'rgba(173,190,115,0.04)'], shadowColor: '#71823C' },
  { id: 'navy', name: 'Navy', accent: '#3A6098', accentLight: '#7F9DCC', accentDim: 'rgba(58,96,152,0.22)', onAccent: '#FFFFFF', secondary: '#7F9DCC', secondaryDim: 'rgba(58,96,152,0.12)', primaryGradient: ['#213B63', '#3A6098', '#7F9DCC'], heroGradient: ['#172A48', '#3A6098', '#7F9DCC'], glowGradient: ['rgba(58,96,152,0.26)', 'rgba(127,157,204,0.04)'], shadowColor: '#3A6098' },
  { id: 'champagne', name: 'Champagne', accent: '#B58C5A', accentLight: '#E6C99F', accentDim: 'rgba(181,140,90,0.20)', onAccent: '#07070F', secondary: '#E6C99F', secondaryDim: 'rgba(181,140,90,0.11)', primaryGradient: ['#7C5C36', '#D4AE7C', '#F2DFC0'], heroGradient: ['#5D4329', '#B58C5A', '#E6C99F'], glowGradient: ['rgba(181,140,90,0.24)', 'rgba(230,201,159,0.04)'], shadowColor: '#B58C5A' },
  { id: 'black', name: 'Black', accent: '#565D67', accentLight: '#A5ADB8', accentDim: 'rgba(165,173,184,0.16)', onAccent: '#FFFFFF', secondary: '#A5ADB8', secondaryDim: 'rgba(165,173,184,0.09)', primaryGradient: ['#0B0C0F', '#424852', '#111318'], heroGradient: ['#050506', '#3C4149', '#0A0B0D'], glowGradient: ['rgba(165,173,184,0.16)', 'rgba(0,0,0,0.02)'], shadowColor: '#A5ADB8' },
  { id: 'silver', name: 'Chrome', accent: '#C7CDD5', accentLight: '#F8FAFC', accentDim: 'rgba(199,205,213,0.18)', onAccent: '#07080A', secondary: '#7D8793', secondaryDim: 'rgba(125,135,147,0.16)', primaryGradient: ['#17191D', '#727A84', '#F8FAFC', '#AAB1BA', '#34383E'], heroGradient: ['#090A0C', '#545B64', '#F3F5F7', '#777F89', '#111317'], glowGradient: ['rgba(248,250,252,0.24)', 'rgba(125,135,147,0.10)', 'rgba(0,0,0,0.02)'], shadowColor: '#DDE2E8' },
  { id: 'black-gold', name: 'Black & Gold', accent: '#C89B3C', accentLight: '#F1D276', accentDim: 'rgba(200,155,60,0.20)', onAccent: '#07070F', secondary: '#F1D276', secondaryDim: 'rgba(200,155,60,0.11)', primaryGradient: ['#17130B', '#C89B3C', '#F1D276', '#5A431C'], heroGradient: ['#090806', '#8A682A', '#F1D276'], glowGradient: ['rgba(200,155,60,0.24)', 'rgba(241,210,118,0.04)'], shadowColor: '#C89B3C' },
  { id: 'emerald-gold', name: 'Emerald Gold', accent: '#D2AE38', accentLight: '#F3DA85', accentDim: 'rgba(210,174,56,0.20)', onAccent: '#07070F', secondary: '#F3DA85', secondaryDim: 'rgba(210,174,56,0.11)', primaryGradient: ['#063E35', '#D2AE38', '#F3DA85'], heroGradient: ['#032B25', '#9C812C', '#F3DA85'], glowGradient: ['rgba(210,174,56,0.24)', 'rgba(6,78,59,0.05)'], shadowColor: '#D2AE38' },
  { id: 'leopard-red', name: 'Leopard Red', accent: '#B9342F', accentLight: '#E46F5A', accentDim: 'rgba(185,52,47,0.20)', onAccent: '#FFFFFF', secondary: '#E46F5A', secondaryDim: 'rgba(185,52,47,0.11)', primaryGradient: ['#5D1715', '#B9342F', '#E46F5A'], heroGradient: ['#32100E', '#B9342F', '#E46F5A'], glowGradient: ['rgba(185,52,47,0.24)', 'rgba(228,111,90,0.04)'], shadowColor: '#B9342F' },
  { id: 'maroon', name: 'Maroon', accent: '#8B2938', accentLight: '#C95867', accentDim: 'rgba(139,41,56,0.22)', onAccent: '#FFFFFF', secondary: '#C95867', secondaryDim: 'rgba(139,41,56,0.12)', primaryGradient: ['#511720', '#8B2938', '#C95867'], heroGradient: ['#361015', '#8B2938', '#C95867'], glowGradient: ['rgba(139,41,56,0.25)', 'rgba(201,88,103,0.04)'], shadowColor: '#8B2938' },
  { id: 'gold', name: 'Gold', accent: '#D09A25', accentLight: '#F5D87A', accentDim: 'rgba(208,154,37,0.20)', onAccent: '#07070F', secondary: '#F5D87A', secondaryDim: 'rgba(208,154,37,0.11)', primaryGradient: ['#7B5714', '#D09A25', '#F5D87A'], heroGradient: ['#4D350D', '#D09A25', '#F5D87A'], glowGradient: ['rgba(208,154,37,0.24)', 'rgba(245,216,122,0.04)'], shadowColor: '#D09A25' },
] as const;

export const DEFAULT_THEME = APP_THEME_PRESETS.find((theme) => theme.id === 'silver')!;
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