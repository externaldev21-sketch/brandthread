import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { API_BASE_URL } from '@/lib/api';
import { track } from '@/lib/analytics';
import { fallbackUuid, loadInstall, reportInstall, type InstallDeps, type InstallState } from '@/lib/installReport';

async function newId(): Promise<string> {
  try {
    const Crypto = await import('expo-crypto');
    return Crypto.randomUUID();
  } catch {
    return fallbackUuid();
  }
}

/**
 * Reports this install once (signed out) and links it to the account after the
 * first sign-in, for the admin install funnel. Fires `app_installed` on the
 * first launch of an install. Native only; off in preview / dev-bypass
 * sessions (`enabled` false). See lib/installReport.ts.
 */
export function useInstallReport(opts: { enabled: boolean; isSignedIn: boolean | undefined; getToken: () => Promise<string | null> }) {
  const state = useRef<InstallState | null>(null);
  const busy = useRef(false);
  const { enabled, isSignedIn, getToken } = opts;

  useEffect(() => {
    if (!enabled || Platform.OS === 'web' || busy.current) return;
    busy.current = true;
    const deps: InstallDeps = {
      storage: AsyncStorage, fetchImpl: fetch, apiBase: API_BASE_URL, newId,
      platform: Platform.OS, appVersion: Constants.expoConfig?.version ?? null,
    };
    void (async () => {
      try {
        if (!state.current) {
          const loaded = await loadInstall(deps);
          state.current = loaded.state;
          if (loaded.isNew) track('app_installed', { platform: Platform.OS });
        }
        const token = isSignedIn ? await getToken().catch(() => null) : null;
        state.current = await reportInstall(deps, state.current, token);
      } finally {
        busy.current = false;
      }
    })();
  }, [enabled, isSignedIn, getToken]);
}
