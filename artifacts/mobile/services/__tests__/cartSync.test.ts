import { describe, expect, it } from 'vitest';
import {
  applyLiveFields, reconcileCartLoad, mergeGuestLines, createSerialSync,
  OUT_OF_STOCK_REASON, NO_LONGER_AVAILABLE_REASON, type CartLiveFields,
} from '../cartSync';
import type { Cart, CartItem, SavedCartItem } from '../cartTypes';

const item = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'line-1', productId: 'p1', variantId: 'v1', productName: 'Tee', variantTitle: 'M',
  sellerId: 's1', sellerName: 'Seller', sellerHandle: 'seller', priceCents: 2500, quantity: 1,
  maxQuantity: 99, isPreOrder: false, inventoryPolicy: 'deny', isAvailable: true, addedAt: '2026-01-01',
  ...over,
});
const saved = (over: Partial<SavedCartItem> = {}): SavedCartItem => ({ ...item(), savedAt: '2026-01-02', ...over });
const live = (over: Partial<CartLiveFields> = {}): CartLiveFields => ({
  priceCents: 2500, compareAtPriceCents: null, stock: 8, available: true, reason: null, priceChanged: false, ...over,
});
const cart = (items: CartItem[] = [], savedItems: SavedCartItem[] = []): Cart => ({ id: 'c1', items, savedItems, updatedAt: '' });

describe('applyLiveFields', () => {
  it('drops `live` / `unavailable` and keeps the rest of the line', () => {
    const out = applyLiveFields({ ...item(), live: live(), unavailable: true });
    expect('live' in out).toBe(false);
    expect('unavailable' in out).toBe(false);
    expect(out).toMatchObject({ id: 'line-1', variantTitle: 'M', isAvailable: true, maxQuantity: 8, priceCents: 2500 });
    expect(out.unavailableReason).toBeUndefined();
  });

  it('flags a sold-out line with the out-of-stock reason (the bag banner)', () => {
    const out = applyLiveFields({ ...item({ maxQuantity: 5 }), live: live({ stock: 0, available: false, reason: 'out_of_stock' }) });
    expect(out.isAvailable).toBe(false);
    expect(out.unavailableReason).toBe(OUT_OF_STOCK_REASON);
    expect(out.maxQuantity).toBe(5);
  });

  it('flags a removed product as no longer available and keeps the snapshot price', () => {
    const out = applyLiveFields({ ...item({ priceCents: 2500 }), live: live({ priceCents: 2500, stock: 0, available: false, reason: 'unavailable' }) });
    expect(out.isAvailable).toBe(false);
    expect(out.unavailableReason).toBe(NO_LONGER_AVAILABLE_REASON);
    expect(out.priceCents).toBe(2500);
  });

  it('takes the current price (sale included) and stock as the cap', () => {
    const out = applyLiveFields({ ...item({ priceCents: 2500 }), live: live({ priceCents: 2000, compareAtPriceCents: 4000, stock: 1, priceChanged: true }) });
    expect(out).toMatchObject({ priceCents: 2000, compareAtPriceCents: 4000, maxQuantity: 1, isAvailable: true });
  });

  it('restores a line that came back in stock', () => {
    const out = applyLiveFields({ ...item({ isAvailable: false, unavailableReason: OUT_OF_STOCK_REASON }), live: live({ stock: 3 }) });
    expect(out.isAvailable).toBe(true);
    expect(out.unavailableReason).toBeUndefined();
  });

  it('leaves a line without (valid) live fields untouched', () => {
    expect(applyLiveFields(item({ maxQuantity: 7 }))).toEqual(item({ maxQuantity: 7 }));
    expect(applyLiveFields({ ...item(), live: { nonsense: true } })).toEqual(item());
  });

  it('keeps the server\'s availability flags on a line without live fields', () => {
    const out = applyLiveFields({ ...item({ isAvailable: false, unavailableReason: 'No longer available' }), unavailable: true });
    expect(out).toMatchObject({ isAvailable: false, unavailableReason: 'No longer available' });
    expect('unavailable' in out).toBe(false);
  });

  it('never touches a dev-web preview product', () => {
    const preview = item({ productId: 'preview-product-1' });
    expect(applyLiveFields({ ...preview, live: live({ available: false, stock: 0, reason: 'unavailable' }) })).toEqual(preview);
  });
});

describe('reconcileCartLoad', () => {
  const local = cart([item({ id: 'local', variantId: 'v-local' })]);

  it('shows the cached bag, unconfirmed, when the server is unreachable', () => {
    expect(reconcileCartLoad({ local, dirty: '0', server: null })).toEqual({ cart: local, push: false, remoteConfirmed: false });
  });

  it('takes the server bag (with live fields) when the cache is clean', () => {
    const d = reconcileCartLoad({ local, dirty: '0', server: { items: [{ ...item({ id: 'srv' }), live: live({ stock: 0, available: false, reason: 'out_of_stock' }) }], savedItems: [] } });
    expect(d.push).toBe(false);
    expect(d.remoteConfirmed).toBe(true);
    expect(d.cart.id).toBe('c1');
    expect(d.cart.items).toHaveLength(1);
    expect(d.cart.items[0]).toMatchObject({ id: 'srv', isAvailable: false });
    expect('live' in d.cart.items[0]).toBe(false);
  });

  it('takes an empty server bag over a clean cache (emptied on another device)', () => {
    const d = reconcileCartLoad({ local, dirty: '0', server: { items: [], savedItems: [] } });
    expect(d.cart.items).toEqual([]);
    expect(d.push).toBe(false);
  });

  it('keeps and pushes local edits the server never got, with live fields by variant', () => {
    const l = cart([item({ id: 'a', variantId: 'v1', quantity: 3 })]);
    const d = reconcileCartLoad({ local: l, dirty: '1', server: { items: [{ ...item({ id: 'old', variantId: 'v1', quantity: 1 }), live: live({ stock: 2 }) }], savedItems: [] } });
    expect(d.push).toBe(true);
    expect(d.cart.items).toHaveLength(1);
    expect(d.cart.items[0]).toMatchObject({ id: 'a', quantity: 3, maxQuantity: 2 });
  });

  it('never wipes an older build\'s never-synced bag: untracked + empty server → keep and push', () => {
    const d = reconcileCartLoad({ local, dirty: null, server: { items: [], savedItems: [] } });
    expect(d.cart.items).toEqual(local.items);
    expect(d.push).toBe(true);
  });

  it('untracked cache with a non-empty server bag trusts the server', () => {
    const d = reconcileCartLoad({ local, dirty: null, server: { items: [item({ id: 'srv' })], savedItems: [] } });
    expect(d.cart.items.map(i => i.id)).toEqual(['srv']);
    expect(d.push).toBe(false);
  });

  it('drops malformed server lines (no integer priceCents)', () => {
    const d = reconcileCartLoad({ local, dirty: '0', server: { items: [{ id: 'x', price: 25 }, null, item({ id: 'ok' })], savedItems: 'nope' } });
    expect(d.cart.items.map(i => i.id)).toEqual(['ok']);
    expect(d.cart.savedItems).toEqual([]);
  });

  it('applies live fields to saved-for-later lines too', () => {
    const d = reconcileCartLoad({ local, dirty: '0', server: { items: [], savedItems: [{ ...saved(), live: live({ available: false, stock: 0, reason: 'out_of_stock' }) }] } });
    expect(d.cart.savedItems[0]).toMatchObject({ isAvailable: false, savedAt: '2026-01-02' });
  });
});

describe('mergeGuestLines', () => {
  it('appends new variants and keeps the higher quantity for shared ones', () => {
    const account = cart([item({ id: 'a', variantId: 'v1', quantity: 2 }), item({ id: 'b', variantId: 'v2', quantity: 5 })]);
    const guest = cart([item({ id: 'g1', variantId: 'v1', quantity: 4 }), item({ id: 'g2', variantId: 'v2', quantity: 1 }), item({ id: 'g3', variantId: 'v3' })]);
    const out = mergeGuestLines(account, guest);
    expect(out.items.map(i => [i.id, i.quantity])).toEqual([['a', 4], ['b', 5], ['g3', 1]]);
    expect(account.items[0].quantity).toBe(2); // input not mutated
  });

  it('merges saved-for-later lines without duplicating a variant already in the bag', () => {
    const account = cart([item({ variantId: 'v1' })], [saved({ id: 's1', variantId: 'v9' })]);
    const guest = cart([], [saved({ id: 'gs1', variantId: 'v1' }), saved({ id: 'gs2', variantId: 'v9' }), saved({ id: 'gs3', variantId: 'v8' })]);
    expect(mergeGuestLines(account, guest).savedItems.map(i => i.id)).toEqual(['s1', 'gs3']);
  });

  it('is idempotent', () => {
    const account = cart([item({ variantId: 'v1', quantity: 1 })]);
    const guest = cart([item({ id: 'g', variantId: 'v2' })]);
    const once = mergeGuestLines(account, guest);
    expect(mergeGuestLines(once, guest).items).toEqual(once.items);
  });
});

describe('createSerialSync', () => {
  function deferred() {
    let resolve!: () => void; let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it('keeps one request in flight and sends only the latest bag afterwards', async () => {
    const sent: number[] = [];
    const gates: ReturnType<typeof deferred>[] = [];
    const q = createSerialSync<number>((n) => { sent.push(n); const d = deferred(); gates.push(d); return d.promise; });
    const p1 = q.schedule(1);
    const p2 = q.schedule(2);
    const p3 = q.schedule(3);
    expect(sent).toEqual([1]);
    gates[0].resolve();
    await new Promise(r => setTimeout(r, 0));
    expect(sent).toEqual([1, 3]);
    gates[1].resolve();
    expect(await Promise.all([p1, p2, p3])).toEqual([true, true, true]);
    expect(sent).toEqual([1, 3]);
  });

  it('reports failure when the latest send fails, and recovers on the next schedule', async () => {
    let fail = true;
    const q = createSerialSync<number>(async () => { if (fail) throw new Error('offline'); });
    expect(await q.schedule(1)).toBe(false);
    fail = false;
    expect(await q.schedule(2)).toBe(true);
  });

  it('a newer bag queued behind a failed send is still sent', async () => {
    const sent: number[] = [];
    const first = deferred();
    const q = createSerialSync<number>((n) => { sent.push(n); return n === 1 ? first.promise : Promise.resolve(); });
    const p1 = q.schedule(1);
    const p2 = q.schedule(2);
    first.reject(new Error('blip'));
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(sent).toEqual([1, 2]);
  });
});
