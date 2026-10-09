/**
 * Keeps guest-checkout access tokens out of AsyncStorage on iOS/Android.
 *
 * A signed-out buyer's checkout session (services/cartService.ts) remembers,
 * per seller, the Stripe session id and the `guestAccessToken` the API issued
 * for verifying that guest order. The token is a bearer credential, so on
 * native it is stored in the keychain/keystore (expo-secure-store) and the
 * AsyncStorage copy of the session carries everything else. A session saved
 * by an older build (token still in AsyncStorage) is migrated the first time
 * it is read: tokens move to secure storage and the AsyncStorage copy is
 * rewritten without them.
 *
 * On web, in tests, or if secure storage fails, the session is stored exactly
 * as before, so a token is never lost.
 */

type PaidGroups = Record<string, { stripeSessionId: string; guestAccessToken?: string } & Record<string, unknown>>;
type WithPaidGroups = { paidGroups?: PaidGroups };

/** Tokens keyed by Stripe session id. */
export type GuestTokenMap = Record<string, string>;

export function hasGuestTokens(session: WithPaidGroups | null | undefined): boolean {
  return Object.values(session?.paidGroups ?? {}).some((paid) => typeof paid?.guestAccessToken === 'string' && paid.guestAccessToken.length > 0);
}

/** Returns a copy of the session without tokens, and the tokens by Stripe session id. */
export function splitGuestTokens<T extends WithPaidGroups>(session: T): { session: T; tokens: GuestTokenMap } {
  const tokens: GuestTokenMap = {};
  if (!session.paidGroups) return { session, tokens };
  const paidGroups: PaidGroups = {};
  for (const [sellerId, paid] of Object.entries(session.paidGroups)) {
    if (typeof paid?.guestAccessToken === 'string' && paid.guestAccessToken && paid.stripeSessionId) {
      tokens[paid.stripeSessionId] = paid.guestAccessToken;
      const { guestAccessToken: _token, ...rest } = paid;
      paidGroups[sellerId] = rest as PaidGroups[string];
    } else {
      paidGroups[sellerId] = paid;
    }
  }
  return { session: { ...session, paidGroups }, tokens };
}

/** Puts tokens back onto the groups whose Stripe session id they belong to. Stale tokens are ignored. */
export function mergeGuestTokens<T extends WithPaidGroups>(session: T, tokens: GuestTokenMap): T {
  if (!session.paidGroups || !Object.keys(tokens).length) return session;
  const paidGroups: PaidGroups = {};
  for (const [sellerId, paid] of Object.entries(session.paidGroups)) {
    const token = paid?.stripeSessionId ? tokens[paid.stripeSessionId] : undefined;
    paidGroups[sellerId] = token && !paid.guestAccessToken ? { ...paid, guestAccessToken: token } : paid;
  }
  return { ...session, paidGroups };
}

export function parseTokenMap(raw: string | null | undefined): GuestTokenMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: GuestTokenMap = {};
    for (const [id, token] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof token === 'string' && token) out[id] = token;
    }
    return out;
  } catch {
    return {};
  }
}

/** SecureStore keys allow only [A-Za-z0-9._-]. */
export function guestTokenKey(scope: string): string {
  return `bt.checkout-guest-tokens.${scope.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export type SecureKeyValue = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

let cached: SecureKeyValue | null | undefined;
// Scopes that may have tokens in secure storage, so sessions that never had
// any (every signed-in checkout) never touch the keychain on save.
const scopesWithTokens = new Set<string>();

/** expo-secure-store on iOS/Android; null on web, in tests, or when unavailable. */
export function getSecureKeyValue(): SecureKeyValue | null {
  if (cached !== undefined) return cached;
  cached = null;
  const os = process.env.EXPO_OS;
  if (os !== 'ios' && os !== 'android') return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    cached = {
      get: (key) => SecureStore.getItemAsync(key),
      set: (key, value) => SecureStore.setItemAsync(key, value),
      remove: (key) => SecureStore.deleteItemAsync(key),
    };
  } catch {
    cached = null;
  }
  return cached;
}

/** Test seam. */
export function __setSecureKeyValueForTests(next: SecureKeyValue | null | undefined): void {
  cached = next;
  scopesWithTokens.clear();
}

/**
 * Serialises a checkout session for AsyncStorage, moving guest tokens to
 * secure storage first. Falls back to the full session if that fails.
 */
export async function serializeCheckoutSession<T extends WithPaidGroups>(session: T, scope: string, secure = getSecureKeyValue()): Promise<string> {
  if (!secure) return JSON.stringify(session);
  const { session: stripped, tokens } = splitGuestTokens(session);
  try {
    if (Object.keys(tokens).length) {
      await secure.set(guestTokenKey(scope), JSON.stringify(tokens));
      scopesWithTokens.add(scope);
    } else if (scopesWithTokens.has(scope)) {
      await secure.remove(guestTokenKey(scope));
      scopesWithTokens.delete(scope);
    }
    return JSON.stringify(stripped);
  } catch {
    return JSON.stringify(session);
  }
}

/**
 * Restores a checkout session read from AsyncStorage: migrates any legacy
 * in-AsyncStorage tokens (via `rewrite`), then merges tokens back from
 * secure storage.
 */
export async function restoreCheckoutSession<T extends WithPaidGroups>(
  session: T,
  scope: string,
  rewrite: (stripped: T) => Promise<void>,
  secure = getSecureKeyValue(),
): Promise<T> {
  if (!secure) return session;
  try {
    const stored = parseTokenMap(await secure.get(guestTokenKey(scope)));
    if (Object.keys(stored).length) scopesWithTokens.add(scope);
    if (hasGuestTokens(session)) {
      const { session: stripped, tokens } = splitGuestTokens(session);
      await secure.set(guestTokenKey(scope), JSON.stringify({ ...stored, ...tokens }));
      scopesWithTokens.add(scope);
      await rewrite(stripped);
      return session;
    }
    return mergeGuestTokens(session, stored);
  } catch {
    return session;
  }
}

export async function clearCheckoutTokens(scope: string, secure = getSecureKeyValue()): Promise<void> {
  if (!secure) return;
  try {
    await secure.remove(guestTokenKey(scope));
    scopesWithTokens.delete(scope);
  } catch {
    // ignore
  }
}
