import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEATURE_FLAG_STORAGE_KEY,
  FEATURE_FLAGS,
  __resetFeatureFlagsForTests,
  hydrateFeatureFlags,
  isFeatureEnabled,
  parseFlagValue,
  resolveFlag,
  sanitizeOverrides,
  setRemoteFlagOverrides,
} from './featureFlags';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: vi.fn(async (key: string) => map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { map.set(key, value); }),
  };
}

describe('flag value parsing', () => {
  it('accepts the usual on/off spellings and ignores anything else', () => {
    for (const on of ['1', 'true', 'TRUE', ' on ', 'yes']) expect(parseFlagValue(on)).toBe(true);
    for (const off of ['0', 'false', 'off', 'no']) expect(parseFlagValue(off)).toBe(false);
    for (const unset of [undefined, '', 'maybe', 1]) expect(parseFlagValue(unset)).toBeUndefined();
  });

  it('keeps only registered names with boolean values', () => {
    expect(sanitizeOverrides({ force_update_gate: false, unknown_flag: true, critical_ota_reload: 'no' })).toEqual({ force_update_gate: false });
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides(['force_update_gate'])).toEqual({});
  });
});

describe('resolveFlag', () => {
  it('remote override beats build env, which beats the default', () => {
    expect(resolveFlag('force_update_gate', {}, undefined)).toBe(FEATURE_FLAGS.force_update_gate.default);
    expect(resolveFlag('force_update_gate', {}, '0')).toBe(false);
    expect(resolveFlag('force_update_gate', { force_update_gate: true }, '0')).toBe(true);
    expect(resolveFlag('force_update_gate', { force_update_gate: false }, '1')).toBe(false);
  });

  it('every registered flag has a description and an EXPO_PUBLIC_FLAG_ env binding', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./featureFlags.ts', import.meta.url), 'utf8');
    for (const [name, def] of Object.entries(FEATURE_FLAGS)) {
      expect(def.description.length).toBeGreaterThan(10);
      // Literal access so Expo can inline it into release builds.
      expect(src).toContain(`process.env.EXPO_PUBLIC_FLAG_${name.toUpperCase()}`);
    }
  });
});

describe('runtime overrides', () => {
  beforeEach(() => __resetFeatureFlagsForTests(memoryStorage()));

  it('applies and persists remote overrides', async () => {
    const storage = memoryStorage();
    __resetFeatureFlagsForTests(storage);
    expect(isFeatureEnabled('force_update_gate')).toBe(true);
    setRemoteFlagOverrides({ force_update_gate: false, nope: true });
    expect(isFeatureEnabled('force_update_gate')).toBe(false);
    await Promise.resolve();
    expect(JSON.parse(storage.map.get(FEATURE_FLAG_STORAGE_KEY)!)).toEqual({ force_update_gate: false });
  });

  it('hydrates the cached overrides on the next launch', async () => {
    __resetFeatureFlagsForTests(memoryStorage({ [FEATURE_FLAG_STORAGE_KEY]: '{"force_update_gate":false}' }));
    await hydrateFeatureFlags();
    expect(isFeatureEnabled('force_update_gate')).toBe(false);
  });

  it('a fresh network result wins over the cache, even when it is empty', async () => {
    __resetFeatureFlagsForTests(memoryStorage({ [FEATURE_FLAG_STORAGE_KEY]: '{"force_update_gate":false}' }));
    setRemoteFlagOverrides({});
    await hydrateFeatureFlags();
    expect(isFeatureEnabled('force_update_gate')).toBe(true);
  });

  it('survives corrupt or missing storage', async () => {
    __resetFeatureFlagsForTests(memoryStorage({ [FEATURE_FLAG_STORAGE_KEY]: '{not json' }));
    await expect(hydrateFeatureFlags()).resolves.toBeUndefined();
    __resetFeatureFlagsForTests(null);
    await expect(hydrateFeatureFlags()).resolves.toBeUndefined();
    expect(() => setRemoteFlagOverrides({ force_update_gate: false })).not.toThrow();
  });
});
