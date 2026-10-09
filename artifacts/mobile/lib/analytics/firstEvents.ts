/**
 * "First time" funnel events, de-duplicated per account on this device.
 *
 * - first_product_published: the first successful product create per account.
 * - first_sale: the seller's order list goes from empty to non-empty. It
 *   fires only on a transition this device has actually seen (an empty list
 *   observed earlier), so an existing seller who already has orders never
 *   fires it on a fresh install or after this ships.
 *
 * Markers live in AsyncStorage under bt:analytics:first:*. Nothing is
 * recorded unless the event can actually be sent (key present, consent
 * granted, not a preview session), so a gated event is not lost forever.
 * Never throws and never changes the promise it observes.
 *
 * Kept free of React Native imports (AsyncStorage is required lazily) so it
 * runs in Node tests.
 */
import { getAnalyticsUserId, isAnalyticsSending, track } from './index';

type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type FirstEventDeps = {
  storage: KeyValueStorage | null;
  canSend: () => boolean;
  send: (event: 'first_product_published' | 'first_sale') => void;
};

const PREFIX = 'bt:analytics:first:';
const SCOPE_RE = /^[A-Za-z0-9_:.-]{1,128}$/;

export function firstEventKey(event: string, scope: string): string {
  return `${PREFIX}${event}:${scope}`;
}

// Same-session guard so two quick successes cannot both read "not yet".
const pending = new Set<string>();

/** Fires `event` once per scope (account). Resolves true when it fired. */
export async function trackFirstOnce(
  event: 'first_product_published',
  scope: string | null | undefined,
  deps: FirstEventDeps = defaultDeps(),
): Promise<boolean> {
  try {
    if (!scope || !SCOPE_RE.test(scope) || !deps.storage || !deps.canSend()) return false;
    const key = firstEventKey(event, scope);
    if (pending.has(key)) return false;
    pending.add(key);
    try {
      if (await deps.storage.getItem(key)) return false;
      await deps.storage.setItem(key, 'done');
      deps.send(event);
      return true;
    } finally {
      pending.delete(key);
    }
  } catch {
    return false;
  }
}

/**
 * Records the seller's current order count for `scope` (account + store) and
 * fires first_sale on an observed empty -> non-empty transition.
 * States: (none) -> 'zero' (seen empty) -> 'done'. A non-empty first
 * observation goes straight to 'done' without firing.
 */
export async function observeOrderCount(
  scope: string | null | undefined,
  count: number,
  deps: FirstEventDeps = defaultDeps(),
): Promise<boolean> {
  try {
    if (!scope || !SCOPE_RE.test(scope) || !deps.storage || !Number.isFinite(count) || count < 0) return false;
    const key = firstEventKey('first_sale', scope);
    if (pending.has(key)) return false;
    pending.add(key);
    try {
      const state = await deps.storage.getItem(key);
      if (state === 'done') return false;
      if (count === 0) {
        if (state !== 'zero') await deps.storage.setItem(key, 'zero');
        return false;
      }
      if (state === 'zero') {
        // Keep 'zero' until the event can actually be sent.
        if (!deps.canSend()) return false;
        await deps.storage.setItem(key, 'done');
        deps.send('first_sale');
        return true;
      }
      await deps.storage.setItem(key, 'done');
      return false;
    } finally {
      pending.delete(key);
    }
  } catch {
    return false;
  }
}

let cachedStorage: KeyValueStorage | null | undefined;
function lazyStorage(): KeyValueStorage | null {
  if (cachedStorage !== undefined) return cachedStorage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage') as { default?: KeyValueStorage };
    cachedStorage = mod.default ?? (mod as unknown as KeyValueStorage);
  } catch {
    cachedStorage = null;
  }
  return cachedStorage;
}

function defaultDeps(): FirstEventDeps {
  return { storage: lazyStorage(), canSend: isAnalyticsSending, send: (event) => track(event) };
}

/** Passes `promise` through unchanged; on success, fires first_product_published for the signed-in account. */
export function trackFirstProductAfter<T>(promise: Promise<T>): Promise<T> {
  try {
    promise.then(
      () => { void trackFirstOnce('first_product_published', getAnalyticsUserId()); },
      () => {},
    );
  } catch {
    // ignore
  }
  return promise;
}

/**
 * Returns a pass-through for the seller order list (`.then(observeSellerOrderRows(store))`):
 * hands the rows back unchanged and feeds their count to the first_sale detector.
 * The store scope is captured when the request starts.
 */
export function observeSellerOrderRows(storeScope: string | null | undefined): <T>(rows: T) => T {
  return (rows) => {
    try {
      const userId = getAnalyticsUserId();
      if (userId && Array.isArray(rows)) void observeOrderCount(`${userId}:${storeScope || 'own'}`, rows.length);
    } catch {
      // ignore
    }
    return rows;
  };
}
