/**
 * Account display preferences, app-wide: text size, high-contrast icons,
 * caption translation language and auto-translate (lib/displayPrefs.ts).
 *
 * Source of truth is the account (GET/PATCH /api/display-preferences); a copy
 * is cached on the device so the app opens at the saved text size before the
 * API answers. The signed-out web preview (?bt_preview=…) never calls the
 * protected API: edits stay on the device there.
 *
 * Also provides DisplayRuntimeContext, which the JSX runtime's Text and icon
 * wrappers read (lib/jsx/displayElements.ts).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import {
  DEFAULT_DISPLAY_PREFS, DISPLAY_PREFS_STORAGE_KEY, DisplayPrefs, normalizeDisplayPrefs, textScaleFor,
} from '@/lib/displayPrefs';
import { DisplayRuntimeContext } from '@/lib/jsx/displayElements';

type DisplayPrefsValue = {
  prefs: DisplayPrefs;
  /** True when edits are saved to the signed-in account (false in the signed-out preview). */
  syncsToAccount: boolean;
  /** Applies at once; rejects (and rolls back) when the account could not be updated. */
  update: (patch: Partial<DisplayPrefs>) => Promise<void>;
};

const DisplayPrefsContext = createContext<DisplayPrefsValue>({
  prefs: DEFAULT_DISPLAY_PREFS,
  syncsToAccount: false,
  update: async () => {},
});

async function readCache(): Promise<DisplayPrefs | null> {
  try {
    const raw = await AsyncStorage.getItem(DISPLAY_PREFS_STORAGE_KEY);
    return raw ? normalizeDisplayPrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(prefs: DisplayPrefs) {
  AsyncStorage.setItem(DISPLAY_PREFS_STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
}

export function DisplayPrefsProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, userId } = useAuth();
  const api = useApi();
  const { theme } = useAppTheme();
  const preview = isBuyerDevPreview() || isSellerDevPreview();
  const syncsToAccount = !!isSignedIn && !preview;
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULT_DISPLAY_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    let cancelled = false;
    readCache().then((cached) => { if (!cancelled && cached) setPrefs(cached); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!syncsToAccount) return;
    let cancelled = false;
    api.displayPreferences.get()
      .then(({ preferences }) => {
        if (cancelled) return;
        const next = normalizeDisplayPrefs(preferences);
        setPrefs(next);
        writeCache(next);
      })
      .catch(() => { /* keep the cached copy; the settings screen shows the error on edit */ });
    return () => { cancelled = true; };
  }, [api, syncsToAccount, userId]);

  const update = useCallback(async (patch: Partial<DisplayPrefs>) => {
    const prior = prefsRef.current;
    const optimistic = normalizeDisplayPrefs({ ...prior, ...patch });
    setPrefs(optimistic);
    writeCache(optimistic);
    if (!syncsToAccount) return;
    try {
      const { preferences } = await api.displayPreferences.update(patch);
      const saved = normalizeDisplayPrefs(preferences);
      setPrefs(saved);
      writeCache(saved);
    } catch (error) {
      setPrefs(prior);
      writeCache(prior);
      throw error;
    }
  }, [api, syncsToAccount]);

  const value = useMemo(() => ({ prefs, syncsToAccount, update }), [prefs, syncsToAccount, update]);
  const runtime = useMemo(() => ({
    textScale: textScaleFor(prefs.textSize),
    highContrastIcons: prefs.highContrastIcons,
    iconForeground: theme.text,
  }), [prefs.textSize, prefs.highContrastIcons, theme.text]);

  return (
    <DisplayPrefsContext.Provider value={value}>
      <DisplayRuntimeContext.Provider value={runtime}>{children}</DisplayRuntimeContext.Provider>
    </DisplayPrefsContext.Provider>
  );
}

export function useDisplayPrefs(): DisplayPrefsValue {
  return useContext(DisplayPrefsContext);
}
