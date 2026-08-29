import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/api';

export type FeatureFlagKey =
  | 'aiPhotoShoot'
  | 'outfitSwap'
  | 'boosts'
  | 'manufacturerHub';

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  aiPhotoShoot: true,
  outfitSwap: true,
  boosts: true,
  manufacturerHub: true,
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