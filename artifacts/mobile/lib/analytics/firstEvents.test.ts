import { describe, expect, it, vi } from 'vitest';
import { firstEventKey, observeOrderCount, trackFirstOnce, type FirstEventDeps } from './firstEvents';

function deps(overrides: Partial<FirstEventDeps> = {}, initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const send = vi.fn();
  const d: FirstEventDeps = {
    storage: {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => { map.set(key, value); },
    },
    canSend: () => true,
    send,
    ...overrides,
  };
  return { d, map, send };
}

describe('trackFirstOnce', () => {
  it('fires once per account', async () => {
    const { d, send } = deps();
    expect(await trackFirstOnce('first_product_published', 'user_a', d)).toBe(true);
    expect(await trackFirstOnce('first_product_published', 'user_a', d)).toBe(false);
    expect(await trackFirstOnce('first_product_published', 'user_b', d)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not double fire on two concurrent successes', async () => {
    const { d, send } = deps();
    const results = await Promise.all([
      trackFirstOnce('first_product_published', 'user_a', d),
      trackFirstOnce('first_product_published', 'user_a', d),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('records nothing while sending is gated, so the event is not lost', async () => {
    let allowed = false;
    const { d, map, send } = deps({ canSend: () => allowed });
    expect(await trackFirstOnce('first_product_published', 'user_a', d)).toBe(false);
    expect(map.size).toBe(0);
    allowed = true;
    expect(await trackFirstOnce('first_product_published', 'user_a', d)).toBe(true);
    expect(send).toHaveBeenCalledWith('first_product_published');
  });

  it('ignores signed-out or odd scopes and storage failures', async () => {
    const { d, send } = deps();
    expect(await trackFirstOnce('first_product_published', null, d)).toBe(false);
    expect(await trackFirstOnce('first_product_published', 'has space', d)).toBe(false);
    const broken = deps({ storage: { getItem: async () => { throw new Error('io'); }, setItem: async () => {} } });
    expect(await trackFirstOnce('first_product_published', 'user_a', broken.d)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('observeOrderCount (first_sale)', () => {
  it('fires on an observed empty -> non-empty transition, once', async () => {
    const { d, map, send } = deps();
    expect(await observeOrderCount('user_a:own', 0, d)).toBe(false);
    expect(map.get(firstEventKey('first_sale', 'user_a:own'))).toBe('zero');
    expect(await observeOrderCount('user_a:own', 0, d)).toBe(false);
    expect(await observeOrderCount('user_a:own', 1, d)).toBe(true);
    expect(await observeOrderCount('user_a:own', 2, d)).toBe(false);
    expect(await observeOrderCount('user_a:own', 0, d)).toBe(false);
    expect(await observeOrderCount('user_a:own', 1, d)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('first_sale');
  });

  it('never fires for a seller first seen with orders already', async () => {
    const { d, map, send } = deps();
    expect(await observeOrderCount('user_a:own', 5, d)).toBe(false);
    expect(map.get(firstEventKey('first_sale', 'user_a:own'))).toBe('done');
    expect(await observeOrderCount('user_a:own', 0, d)).toBe(false);
    expect(await observeOrderCount('user_a:own', 1, d)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the transition pending while sending is gated', async () => {
    let allowed = false;
    const { d, send } = deps({ canSend: () => allowed });
    await observeOrderCount('user_a:own', 0, d);
    expect(await observeOrderCount('user_a:own', 1, d)).toBe(false);
    allowed = true;
    expect(await observeOrderCount('user_a:own', 1, d)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('tracks each account/store separately and rejects bad input', async () => {
    const { d, send } = deps();
    await observeOrderCount('user_a:own', 0, d);
    expect(await observeOrderCount('user_a:store_2', 1, d)).toBe(false);
    expect(await observeOrderCount('user_a:own', -1, d)).toBe(false);
    expect(await observeOrderCount('user_a:own', Number.NaN, d)).toBe(false);
    expect(await observeOrderCount(null, 1, d)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
