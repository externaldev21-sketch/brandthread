/**
 * One version stamp for every on-device cache that paints UI before the
 * network answers (TanStack Query persister, feedPostsCache, tabDataCache).
 *
 * A cached payload written by an older build can have a different shape than
 * the screen now expects. Instead of letting a renamed field crash the first
 * frame after an update, anything written under a different stamp is simply
 * ignored (and swept off disk), so the app falls back to a normal network load.
 *
 * Bump CACHE_SCHEMA_VERSION whenever a cached shape changes in an OTA update;
 * a new native build (app version) invalidates automatically.
 */
import Constants from 'expo-constants';

export const CACHE_SCHEMA_VERSION = 1;

function appVersion(): string {
  try {
    return Constants.expoConfig?.version ?? '0';
  } catch {
    return '0';
  }
}

/** e.g. "1@1.0.0" — used as the persister buster and as a key segment. */
export function cacheStamp(): string {
  return `${CACHE_SCHEMA_VERSION}@${appVersion()}`;
}

/**
 * Pure: which of `keys` belong to one of `prefixes` but were written under a
 * different stamp than `stamp`. Keys are `<prefix><stamp>:<rest>`.
 */
export function staleCacheKeys(keys: readonly string[], prefixes: readonly string[], stamp: string): string[] {
  return keys.filter((key) => {
    const prefix = prefixes.find((p) => key.startsWith(p));
    if (!prefix) return false;
    return !key.startsWith(`${prefix}${stamp}:`);
  });
}
