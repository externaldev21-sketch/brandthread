import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { type AppThemeId, APP_THEME_PRESETS, useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';

export type AppIconPreference = AppThemeId | null;

const FOLLOW_THEME_STORAGE_VALUE = 'follow-theme';
const ICON_STORAGE_VERSION = 'v1';
const APP_ICON_IDS = new Set<AppThemeId>(APP_THEME_PRESETS.map((preset) => preset.id));

export const isAppIconId = (value: unknown): value is AppThemeId =>
  typeof value === 'string' && APP_ICON_IDS.has(value as AppThemeId);

export const appIconStorageKeyFor = (userId?: string | null) =>
  `@brandthread/app-icon:${ICON_STORAGE_VERSION}:${userId ?? 'guest'}`;

export const nativeIconNameFor = (iconId: AppThemeId) => iconId.replaceAll('-', '_');

function decodeStoredPreference(value: string | null): AppIconPreference | undefined {
  if (value === FOLLOW_THEME_STORAGE_VALUE) return null;
  return isAppIconId(value) ? value : undefined;
}

function encodeStoredPreference(value: AppIconPreference): string {
  return value ?? FOLLOW_THEME_STORAGE_VALUE;
}

function canUseNativeAppIcons(): boolean {
  if (Platform.OS === 'web') return false;
  // appOwnership is deprecated in favor of executionEnvironment, but it is the
  // only value that distinguishes Expo Go from a custom development client.
  return Constants.appOwnership !== 'expo';
}

export async function applyDeviceAppIcon(iconId: AppThemeId): Promise<boolean> {
  if (!canUseNativeAppIcons()) return false;
  try {
    // Do not statically import this native module. Expo Go does not include it.
    const { getAppIcon, getAvailableAppIcons, setAppIcon } = await import('expo-runtime-app-icon');
    const nativeIconName = nativeIconNameFor(iconId);
    const availableIcons = getAvailableAppIcons();
    if (!availableIcons.includes(nativeIconName)) return false;
    if (getAppIcon() !== nativeIconName) await setAppIcon(nativeIconName);
    return true;
  } catch {
    // Theme selection must remain successful when the launcher or build cannot
    // switch icons (Expo Go, web, unsupported launchers, or incomplete builds).
    return false;
  }
}

type AppIconContextValue = {
  preference: AppIconPreference;
  resolvedIconId: AppThemeId;
  followsTheme: boolean;
  isHydrated: boolean;
  selectIcon: (preference: AppIconPreference) => Promise<void>;
};

const AppIconContext = createContext<AppIconContextValue>({
  preference: null,
  resolvedIconId: 'monochrome',
  followsTheme: true,
  isHydrated: false,
  selectIcon: async () => undefined,
});

export function AppIconProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const api = useApi();
  const { theme, isHydrated: isThemeHydrated } = useAppTheme();
  const [preference, setPreference] = useState<AppIconPreference>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const storageKey = appIconStorageKeyFor(userId);
  const resolvedIconId = preference ?? theme.id;

  useEffect(() => {
    let active = true;
    setPreference(null);
    setIsHydrated(false);

    api.auth.me()
      .then(async (profile) => {
        if (!active) return;
        const serverPreference = profile?.appIconId;
        if (serverPreference === null || isAppIconId(serverPreference)) {
          setPreference(serverPreference);
          await AsyncStorage.setItem(storageKey, encodeStoredPreference(serverPreference));
          return;
        }
        const saved = decodeStoredPreference(await AsyncStorage.getItem(storageKey));
        if (active && saved !== undefined) setPreference(saved);
      })
      .catch(async () => {
        const saved = decodeStoredPreference(await AsyncStorage.getItem(storageKey));
        if (active && saved !== undefined) setPreference(saved);
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });

    return () => { active = false; };
  }, [api, storageKey]);

  useEffect(() => {
    if (!isHydrated || !isThemeHydrated) return;
    void applyDeviceAppIcon(resolvedIconId);
  }, [isHydrated, isThemeHydrated, resolvedIconId]);

  const selectIcon = useCallback(async (nextPreference: AppIconPreference) => {
    if (nextPreference !== null && !isAppIconId(nextPreference)) return;
    setPreference(nextPreference);
    const nextResolvedIconId = nextPreference ?? theme.id;
    void applyDeviceAppIcon(nextResolvedIconId);
    try {
      await AsyncStorage.setItem(storageKey, encodeStoredPreference(nextPreference));
      await api.auth.updateProfile({
        appIconId: nextPreference,
        ...(userId ? { expectedClerkId: userId } : {}),
      });
    } catch {
      // Keep the account-scoped local choice while offline.
    }
  }, [api, storageKey, theme.id, userId]);

  const value = useMemo<AppIconContextValue>(() => ({
    preference,
    resolvedIconId,
    followsTheme: preference === null,
    isHydrated,
    selectIcon,
  }), [isHydrated, preference, resolvedIconId, selectIcon]);

  return <AppIconContext.Provider value={value}>{children}</AppIconContext.Provider>;
}

export function useAppIconPreference() {
  return useContext(AppIconContext);
}