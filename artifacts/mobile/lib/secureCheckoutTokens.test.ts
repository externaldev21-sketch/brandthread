import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setSecureKeyValueForTests,
  getSecureKeyValue,
  guestTokenKey,
  mergeGuestTokens,
  restoreCheckoutSession,
  serializeCheckoutSession,
  splitGuestTokens,
  type SecureKeyValue,
} from './secureCheckoutTokens';

const session = () => ({
  id: 'ck_1',
  paidGroups: {
    seller_a: { stripeSessionId: 'cs_a', guestAccessToken: 'tok_a' },
    seller_b: { stripeSessionId: 'cs_b', orderId: 'ord_b' },
  },
});

function memorySecure(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store: SecureKeyValue = {
    get: vi.fn(async (key: string) => map.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { map.set(key, value); }),
    remove: vi.fn(async (key: string) => { map.delete(key); }),
  };
  return { store, map };
}

beforeEach(() => __setSecureKeyValueForTests(undefined));

describe('split / merge', () => {
  it('moves tokens out by Stripe session id and back again', () => {
    const { session: stripped, tokens } = splitGuestTokens(session());
    expect(tokens).toEqual({ cs_a: 'tok_a' });
    expect(JSON.stringify(stripped)).not.toContain('tok_a');
    expect(stripped.paidGroups.seller_b).toEqual({ stripeSessionId: 'cs_b', orderId: 'ord_b' });
    expect(mergeGuestTokens(stripped, tokens)).toEqual(session());
  });

  it('ignores stale tokens for sessions no longer in the checkout', () => {
    const { session: stripped } = splitGuestTokens(session());
    const merged = mergeGuestTokens(stripped, { cs_old: 'tok_old', cs_a: 'tok_a' });
    expect(JSON.stringify(merged)).not.toContain('tok_old');
  });

  it('builds a SecureStore-safe key', () => {
    expect(guestTokenKey('anon')).toBe('bt.checkout-guest-tokens.anon');
    expect(guestTokenKey('user:1/2')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('serialize / restore', () => {
  it('stores the token in secure storage, not in the AsyncStorage JSON', async () => {
    const { store, map } = memorySecure();
    const json = await serializeCheckoutSession(session(), 'anon', store);
    expect(json).not.toContain('tok_a');
    expect(JSON.parse(map.get(guestTokenKey('anon'))!)).toEqual({ cs_a: 'tok_a' });
    const restored = await restoreCheckoutSession(JSON.parse(json), 'anon', vi.fn(), store);
    expect(restored).toEqual(session());
  });

  it('migrates a legacy session that still has the token in AsyncStorage', async () => {
    const { store, map } = memorySecure();
    const rewrite = vi.fn(async (_stripped: unknown) => {});
    const restored = await restoreCheckoutSession(session(), 'anon', rewrite, store);
    expect(restored).toEqual(session());
    expect(JSON.parse(map.get(guestTokenKey('anon'))!)).toEqual({ cs_a: 'tok_a' });
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rewrite.mock.calls[0][0])).not.toContain('tok_a');
  });

  it('keeps the token in the session if secure storage fails, so it is never lost', async () => {
    const failing: SecureKeyValue = {
      get: async () => { throw new Error('locked'); },
      set: async () => { throw new Error('locked'); },
      remove: async () => {},
    };
    expect(await serializeCheckoutSession(session(), 'anon', failing)).toContain('tok_a');
    expect(await restoreCheckoutSession(session(), 'anon', vi.fn(), failing)).toEqual(session());
  });

  it('does not touch the keychain for sessions that never had tokens', async () => {
    const { store } = memorySecure();
    __setSecureKeyValueForTests(store);
    await serializeCheckoutSession({ paidGroups: { s: { stripeSessionId: 'cs' } } }, 'user_1', store);
    expect(store.set).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('is a pass-through without secure storage (web, tests)', async () => {
    expect(getSecureKeyValue()).toBeNull();
    expect(await serializeCheckoutSession(session(), 'anon', null)).toContain('tok_a');
    expect(await restoreCheckoutSession(session(), 'anon', vi.fn(), null)).toEqual(session());
  });
});
