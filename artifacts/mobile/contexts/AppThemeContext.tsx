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
  secondary: string;
  secondaryDim: string;
  swatchBackground: readonly [string, string];
  markColor: string;
  markShadow: string;
};

export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  { id: 'purple', name: 'Purple', accent: '#8B5CF6', accentLight: '#A78BFA', accentDim: 'rgba(139,92,246,0.18)', secondary: '#22D3EE', secondaryDim: 'rgba(34,211,238,0.15)', swatchBackground: ['#28134F', '#07070F'], markColor: '#BBA4FF', markShadow: '#6D42D5' },
  { id: 'olive', name: 'Olive', accent: '#71823C', accentLight: '#ADBE73', accentDim: 'rgba(113,130,60,0.20)', secondary: '#B8A04A', secondaryDim: 'rgba(184,160,74,0.16)', swatchBackground: ['#536127', '#101408'], markColor: '#D7DEA6', markShadow: '#2D380F' },
  { id: 'navy', name: 'Navy', accent: '#3A6098', accentLight: '#7F9DCC', accentDim: 'rgba(58,96,152,0.22)', secondary: '#69B7D0', secondaryDim: 'rgba(105,183,208,0.16)', swatchBackground: ['#183865', '#070F22'], markColor: '#AFC7EF', markShadow: '#102B54' },
  { id: 'champagne', name: 'Champagne', accent: '#B58C5A', accentLight: '#E6C99F', accentDim: 'rgba(181,140,90,0.20)', secondary: '#A96F42', secondaryDim: 'rgba(169,111,66,0.16)', swatchBackground: ['#E7D2AB', '#AA835E'], markColor: '#FFF1D3', markShadow: '#79512D' },
  { id: 'black', name: 'Black', accent: '#565D67', accentLight: '#A5ADB8', accentDim: 'rgba(165,173,184,0.16)', secondary: '#818996', secondaryDim: 'rgba(129,137,150,0.16)', swatchBackground: ['#262A30', '#010101'], markColor: '#D5D9DE', markShadow: '#000000' },
  { id: 'silver', name: 'Silver', accent: '#9AA3B0', accentLight: '#EEF1F5', accentDim: 'rgba(154,163,176,0.20)', secondary: '#758292', secondaryDim: 'rgba(117,130,146,0.16)', swatchBackground: ['#FFFFFF', '#C5CAD1'], markColor: '#3D4552', markShadow: '#FFFFFF' },
  { id: 'black-gold', name: 'Black & Gold', accent: '#C89B3C', accentLight: '#F1D276', accentDim: 'rgba(200,155,60,0.20)', secondary: '#99722A', secondaryDim: 'rgba(153,114,42,0.17)', swatchBackground: ['#111111', '#000000'], markColor: '#D9B45D', markShadow: '#714F0E' },
  { id: 'emerald-gold', name: 'Emerald Gold', accent: '#D2AE38', accentLight: '#F3DA85', accentDim: 'rgba(210,174,56,0.20)', secondary: '#1B7A53', secondaryDim: 'rgba(27,122,83,0.18)', swatchBackground: ['#164C37', '#061C14'], markColor: '#FFE59A', markShadow: '#96751B' },
  { id: 'leopard-red', name: 'Leopard Red', accent: '#B9342F', accentLight: '#E46F5A', accentDim: 'rgba(185,52,47,0.20)', secondary: '#A06E45', secondaryDim: 'rgba(160,110,69,0.16)', swatchBackground: ['#BD8B53', '#5D321F'], markColor: '#F08A70', markShadow: '#70211E' },
  { id: 'maroon', name: 'Maroon', accent: '#8B2938', accentLight: '#C95867', accentDim: 'rgba(139,41,56,0.22)', secondary: '#651824', secondaryDim: 'rgba(101,24,36,0.18)', swatchBackground: ['#651A29', '#280B13'], markColor: '#E36D78', markShadow: '#4A101B' },
  { id: 'gold', name: 'Gold', accent: '#D09A25', accentLight: '#F5D87A', accentDim: 'rgba(208,154,37,0.20)', secondary: '#946A17', secondaryDim: 'rgba(148,106,23,0.16)', swatchBackground: ['#211805', '#000000'], markColor: '#FFE28B', markShadow: '#8A5D0A' },
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