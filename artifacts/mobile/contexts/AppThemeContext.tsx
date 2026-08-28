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
};

export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  { id: 'purple', name: 'Purple', accent: '#8B5CF6', accentLight: '#A78BFA', accentDim: 'rgba(139,92,246,0.18)', onAccent: '#FFFFFF', secondary: '#A78BFA', secondaryDim: 'rgba(139,92,246,0.10)' },
  { id: 'olive', name: 'Olive', accent: '#71823C', accentLight: '#ADBE73', accentDim: 'rgba(113,130,60,0.20)', onAccent: '#FFFFFF', secondary: '#ADBE73', secondaryDim: 'rgba(113,130,60,0.11)' },
  { id: 'navy', name: 'Navy', accent: '#3A6098', accentLight: '#7F9DCC', accentDim: 'rgba(58,96,152,0.22)', onAccent: '#FFFFFF', secondary: '#7F9DCC', secondaryDim: 'rgba(58,96,152,0.12)' },
  { id: 'champagne', name: 'Champagne', accent: '#B58C5A', accentLight: '#E6C99F', accentDim: 'rgba(181,140,90,0.20)', onAccent: '#07070F', secondary: '#E6C99F', secondaryDim: 'rgba(181,140,90,0.11)' },
  { id: 'black', name: 'Black', accent: '#565D67', accentLight: '#A5ADB8', accentDim: 'rgba(165,173,184,0.16)', onAccent: '#FFFFFF', secondary: '#A5ADB8', secondaryDim: 'rgba(165,173,184,0.09)' },
  { id: 'silver', name: 'Silver', accent: '#9AA3B0', accentLight: '#EEF1F5', accentDim: 'rgba(154,163,176,0.20)', onAccent: '#07070F', secondary: '#EEF1F5', secondaryDim: 'rgba(154,163,176,0.11)' },
  { id: 'black-gold', name: 'Black & Gold', accent: '#C89B3C', accentLight: '#F1D276', accentDim: 'rgba(200,155,60,0.20)', onAccent: '#07070F', secondary: '#F1D276', secondaryDim: 'rgba(200,155,60,0.11)' },
  { id: 'emerald-gold', name: 'Emerald Gold', accent: '#D2AE38', accentLight: '#F3DA85', accentDim: 'rgba(210,174,56,0.20)', onAccent: '#07070F', secondary: '#F3DA85', secondaryDim: 'rgba(210,174,56,0.11)' },
  { id: 'leopard-red', name: 'Leopard Red', accent: '#B9342F', accentLight: '#E46F5A', accentDim: 'rgba(185,52,47,0.20)', onAccent: '#FFFFFF', secondary: '#E46F5A', secondaryDim: 'rgba(185,52,47,0.11)' },
  { id: 'maroon', name: 'Maroon', accent: '#8B2938', accentLight: '#C95867', accentDim: 'rgba(139,41,56,0.22)', onAccent: '#FFFFFF', secondary: '#C95867', secondaryDim: 'rgba(139,41,56,0.12)' },
  { id: 'gold', name: 'Gold', accent: '#D09A25', accentLight: '#F5D87A', accentDim: 'rgba(208,154,37,0.20)', onAccent: '#07070F', secondary: '#F5D87A', secondaryDim: 'rgba(208,154,37,0.11)' },
] as const;

const DEFAULT_THEME = APP_THEME_PRESETS[0];
const getTheme = (id: AppThemeId) => APP_THEME_PRESETS.find((theme) => theme.id === id) ?? DEFAULT_THEME;
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
  const [themeId, setThemeId] = useState<AppThemeId>('purple');
  const [isHydrated, setIsHydrated] = useState(false);
  const storageKey = storageKeyFor(userId);

  useEffect(() => {
    let active = true;
    setIsHydrated(false);
    setThemeId('purple');
    AsyncStorage.getItem(storageKey)
      .then((saved) => {
        if (!active || !saved || !APP_THEME_PRESETS.some((theme) => theme.id === saved)) return;
        setThemeId(saved as AppThemeId);
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => { active = false; };
  }, [storageKey]);

  const selectTheme = useCallback(async (id: AppThemeId) => {
    if (!APP_THEME_PRESETS.some((theme) => theme.id === id)) return;
    setThemeId(id);
    await AsyncStorage.setItem(storageKey, id);
  }, [storageKey]);

  const value = useMemo(() => ({ theme: getTheme(themeId), isHydrated, selectTheme }), [isHydrated, selectTheme, themeId]);
  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}