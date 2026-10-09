/**
 * Release flags: a typed registry of switches for shipping code dark.
 *
 * How a flag resolves, highest priority first:
 *   1. Remote override: `flags` in GET /api/v1/app/config (server env
 *      APP_FLAGS='{"my_flag":true}'), cached in AsyncStorage so it also
 *      applies on the next cold start before the network answers.
 *   2. Build env: EXPO_PUBLIC_FLAG_<NAME>=1|true|on|0|false|off at build time.
 *   3. The registry default. Unfinished work defaults to OFF.
 *
 * Adding a flag:
 *   1. Add an entry to FEATURE_FLAGS below. `env` must read
 *      process.env.EXPO_PUBLIC_FLAG_<NAME> as a literal property access:
 *      Expo inlines EXPO_PUBLIC_* vars only when written out in full, so a
 *      computed `process.env[name]` is always undefined in a release build.
 *   2. Gate code with `isFeatureEnabled('my_flag')` (plain code) or
 *      `useFeatureFlag('my_flag')` (components; re-renders when a remote
 *      override arrives).
 *   3. Delete the flag once the feature has shipped to everyone.
 *
 * Not to be confused with contexts/FeatureFlagContext.tsx, which serves the
 * operator-toggled, database-backed kill switches from /api/config/features
 * (signed-in only). These release flags are build/env driven and work
 * signed out.
 */
import { useSyncExternalStore } from 'react';
import { subscribeAppConfig } from '@/lib/appConfig';

type FlagDefinition = {
  /** Value when neither the build env nor a remote override sets it. */
  default: boolean;
  description: string;
  /** The inlined EXPO_PUBLIC_FLAG_<NAME> value (undefined when unset). */
  env: string | undefined;
};

export const FEATURE_FLAGS = {
  force_update_gate: {
    default: true,
    description: 'Blocking "Update Brandthread" screen when the native app is older than the server minimum. Kill switch.',
    env: process.env.EXPO_PUBLIC_FLAG_FORCE_UPDATE_GATE,
  },
  critical_ota_reload: {
    default: true,
    description: 'Reload into a downloaded critical OTA update when the app returns from the background. Kill switch.',
    env: process.env.EXPO_PUBLIC_FLAG_CRITICAL_OTA_RELOAD,
  },
} as const satisfies Record<string, FlagDefinition>;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;

export const FEATURE_FLAG_STORAGE_KEY = 'bt:release-flags:remote:v1';

/** Parses a build-env flag value. Anything unrecognised is "unset". */
export function parseFlagValue(raw: unknown): boolean | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'on' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'off' || value === 'no') return false;
  return undefined;
}

function isFlagName(name: string): name is FeatureFlagName {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, name);
}

/** Keeps only registered flag names with boolean values. */
export function sanitizeOverrides(raw: unknown): Partial<Record<FeatureFlagName, boolean>> {
  const out: Partial<Record<FeatureFlagName, boolean>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isFlagName(name) && typeof value === 'boolean') out[name] = value;
  }
  return out;
}

/** Pure resolution: remote override, then build env, then default. */
export function resolveFlag(
  name: FeatureFlagName,
  overrides: Partial<Record<FeatureFlagName, boolean>>,
  envValue: unknown = FEATURE_FLAGS[name].env,
): boolean {
  const remote = overrides[name];
  if (typeof remote === 'boolean') return remote;
  const env = parseFlagValue(envValue);
  if (typeof env === 'boolean') return env;
  return FEATURE_FLAGS[name].default;
}

// ─── Runtime state ────────────────────────────────────────────────────────────

type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let overrides: Partial<Record<FeatureFlagName, boolean>> = {};
let remoteLoaded = false;
let version = 0;
const listeners = new Set<() => void>();
let hydration: Promise<void> | null = null;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function defaultStorage(): KeyValueStorage | null {
  try {
    // Lazy so this module (and lib/otaUpdates) stays loadable in Node tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage') as { default?: KeyValueStorage };
    return mod.default ?? (mod as unknown as KeyValueStorage);
  } catch {
    return null;
  }
}

let storage: KeyValueStorage | null | undefined;
function getStorage(): KeyValueStorage | null {
  if (storage === undefined) storage = defaultStorage();
  return storage;
}

/** Test seam: replaces the storage backend and clears in-memory state. */
export function __resetFeatureFlagsForTests(next: KeyValueStorage | null): void {
  storage = next;
  overrides = {};
  remoteLoaded = false;
  hydration = null;
  emit();
}

/** Applies remote overrides (from the app config) and persists them for the next launch. */
export function setRemoteFlagOverrides(raw: unknown): void {
  const next = sanitizeOverrides(raw);
  const changed = JSON.stringify(next) !== JSON.stringify(overrides);
  overrides = next;
  remoteLoaded = true;
  if (changed) emit();
  try {
    void getStorage()?.setItem(FEATURE_FLAG_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  } catch {
    // Persisting is best-effort.
  }
}

/** Loads the cached remote overrides once. Safe to call repeatedly. */
export function hydrateFeatureFlags(): Promise<void> {
  hydration ??= (async () => {
    try {
      const raw = await getStorage()?.getItem(FEATURE_FLAG_STORAGE_KEY);
      // A fresh network result that arrived first wins over the cache.
      if (raw && !remoteLoaded) {
        const cached = sanitizeOverrides(JSON.parse(raw));
        if (Object.keys(cached).length) {
          overrides = cached;
          emit();
        }
      }
    } catch {
      // Corrupt or unavailable cache: defaults apply.
    }
  })();
  return hydration;
}

export function isFeatureEnabled(name: FeatureFlagName): boolean {
  return resolveFlag(name, overrides);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: the flag's current value; re-renders when a remote override changes it. */
export function useFeatureFlag(name: FeatureFlagName): boolean {
  useSyncExternalStore(subscribe, () => version, () => version);
  return isFeatureEnabled(name);
}

// Every successful app-config load refreshes the overrides.
subscribeAppConfig((config) => setRemoteFlagOverrides(config.flags));
