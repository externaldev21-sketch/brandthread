/**
 * Per-account local storage scoping.
 *
 * Several caches used to live under one device-wide AsyncStorage key, so two
 * accounts signed in on the same phone read (and wrote) each other's data.
 * Every such key is now suffixed with the signed-in Clerk user id via
 * accountStorageKey(); signed out (and the dev web preview, which has no
 * user) uses the 'anon' scope, which never sees an account's data.
 *
 * app/_layout.tsx calls setAccountStorageScope(userId) whenever the Clerk
 * user changes (null on sign-out), next to initSocialService().
 *
 * Legacy (pre-scoping) keys are handled once by adoptLegacyKey():
 *   - 'claim': the first signed-in account to read it takes it over (copied to
 *     its scoped key only if that is still empty) and the device-wide key is
 *     deleted, so it can never reach a second account. That data was already
 *     visible to whoever was signed in, so this adds no new exposure.
 *   - 'drop': deleted without being read. Used where replaying another
 *     account's data would be harmful (queued actions) or where the server
 *     re-hydrates the cache anyway.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ANON_SCOPE = 'anon';

let scope = ANON_SCOPE;
const listeners = new Set<(scope: string) => void>();

export function setAccountStorageScope(userId: string | null | undefined): void {
  const next = userId || ANON_SCOPE;
  if (next === scope) return;
  scope = next;
  listeners.forEach((fn) => { try { fn(next); } catch { /* listener errors never block a switch */ } });
}

export function getAccountStorageScope(): string {
  return scope;
}

/** Called after every account switch (new scope id passed in). */
export function onAccountStorageScopeChange(fn: (scope: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** `${base}:u:${userId}` — the account-scoped version of a storage key. */
export function accountStorageKey(base: string, userId: string = scope): string {
  return `${base}:u:${userId || ANON_SCOPE}`;
}

const handledLegacy = new Set<string>();

/**
 * One-time handling of a device-wide legacy key (see file header).
 * Safe to call before every read; it touches storage at most once per key
 * per app session, and never claims into the anonymous scope.
 */
export async function adoptLegacyKey(
  legacyKey: string,
  mode: 'claim' | 'drop',
  userId: string = scope,
): Promise<void> {
  if (handledLegacy.has(legacyKey)) return;
  if (mode === 'claim' && userId === ANON_SCOPE) return;
  handledLegacy.add(legacyKey);
  try {
    if (mode === 'claim') {
      const legacy = await AsyncStorage.getItem(legacyKey);
      if (legacy !== null) {
        const target = accountStorageKey(legacyKey, userId);
        const existing = await AsyncStorage.getItem(target);
        if (existing === null) await AsyncStorage.setItem(target, legacy);
      }
    }
    await AsyncStorage.removeItem(legacyKey);
  } catch {
    // Storage unavailable: try again next session rather than lose data.
    handledLegacy.delete(legacyKey);
  }
}

/** Convenience: adopt the legacy key (if any) and return the scoped key for `userId`. */
export async function resolveAccountKey(
  legacyKey: string,
  mode: 'claim' | 'drop',
  userId: string = scope,
): Promise<string> {
  await adoptLegacyKey(legacyKey, mode, userId);
  return accountStorageKey(legacyKey, userId);
}

/** Test-only. */
export function __resetAccountStorageForTests(): void {
  scope = ANON_SCOPE;
  listeners.clear();
  handledLegacy.clear();
}
