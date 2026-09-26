import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/api';

export type FeatureFlagKey =
  | 'aiPhotoShoot'
  | 'outfitSwap'
  | 'boosts'
  | 'manufacturerHub'
  | 'threadCash'
  | 'threadCashCheckoutDiscount'
  | 'threadCashSend'
  | 'oauthGoogleEnabled'
  | 'oauthAppleEnabled';

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  aiPhotoShoot: true,
  outfitSwap: true,
  boosts: true,
  manufacturerHub: true,
  threadCash: true,
  // Sign in/up with Google or Apple. Default on (both are wired to Clerk
  // OAuth). If a provider isn't actually configured on the Clerk instance,
  // flip its flag off server-side (PUT /api/feature-flags/oauthGoogleEnabled
  // or oauthAppleEnabled with { enabled: false }) rather than shipping a
  // button that errors for real users.
  oauthGoogleEnabled: true,
  oauthAppleEnabled: true,
  // OFF until an operator reviews the sign-off checklist and flips it on
  // server-side (see docs/payments/thread-cash-checkout-todo.md) — the
  // money flow itself is implemented and tested.
  threadCashCheckoutDiscount: false,
  // ON by default server-side (mutual-follow required, still a server-side
  // kill switch) — this fallback only covers the brief window before the
  // real flags load.
  threadCashSend: true,
};

const STORAGE_KEY = 'bt:feature-flags:v1';

type FeatureFlagContextValue = {
  flags: Record<string, boolean>;
  isEnabled: (key: FeatureFlagKey) => boolean;
  refresh: () => Promise<void>;
};

const FeatureFlagContext = createContext<FeatureFlagContextValue>({
  flags: DEFAULT_FLAGS,
  isEnabled: (key) => DEFAULT_FLAGS[key],
  refresh: async () => {},
});

export function FeatureFlagProvider({ children }: PropsWithChildren) {
  const api = useApi();
  const [flags, setFlags] = useState<Record<string, boolean>>(DEFAULT_FLAGS);

  const refresh = async () => {
    const response = await api.config.featureFlags();
    const next = { ...DEFAULT_FLAGS, ...response.flags };
    setFlags(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && stored) setFlags({ ...DEFAULT_FLAGS, ...JSON.parse(stored) });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) void refresh().catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<FeatureFlagContextValue>(
    () => ({
      flags,
      isEnabled: (key) => flags[key] ?? DEFAULT_FLAGS[key],
      refresh,
    }),
    [flags],
  );

  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

export function useFeatureFlags(): FeatureFlagContextValue {
  return useContext(FeatureFlagContext);
}

export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useFeatureFlags().isEnabled(key);
}