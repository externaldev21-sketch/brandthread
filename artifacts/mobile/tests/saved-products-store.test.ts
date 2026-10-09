import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSavedProductsStore, type SavedProductDraft } from '@/lib/saved/savedProductsStore';

const DRAFT: SavedProductDraft = { productId: 'p1', title: 'Ripstop jacket', brand: 'Meridian Co.', priceCents: 8000 };

function deferred<T = void>() {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolveFn = res; rejectFn = rej; });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function makeStore(overrides: Partial<Parameters<typeof createSavedProductsStore>[0]> = {}) {
  const deps = {
    fetchSaved: vi.fn(async () => [
      { type: 'product', targetId: 'p1' },
      { type: 'post', targetId: 'post_9' },
      { type: 'product', targetId: 'p2' },
    ]),
    save: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    ...overrides,
  };
  return { store: createSavedProductsStore(deps), deps };
}

describe('saved products store', () => {
  it('makes no API calls while signed out and asks the caller to prompt sign-in', async () => {
    const { store, deps } = makeStore();
    await store.load();
    const result = await store.toggle(DRAFT);
    expect(result).toEqual({ ok: false, saved: false, reason: 'signed-out' });
    expect(deps.fetchSaved).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(store.has('p1')).toBe(false);
  });

  it('batch-loads saved product ids once on sign-in, ignoring non-product rows', async () => {
    const { store, deps } = makeStore();
    store.setSignedIn(true, 'user_a');
    await store.load();
    await store.load();
    expect(deps.fetchSaved).toHaveBeenCalledTimes(1);
    expect(store.has('p1')).toBe(true);
    expect(store.has('p2')).toBe(true);
    expect(store.has('post_9')).toBe(false);
    expect(store.isLoaded()).toBe(true);
  });

  it('toggles optimistically before the server answers, then keeps the value', async () => {
    const gate = deferred();
    const { store, deps } = makeStore({ save: vi.fn(() => gate.promise) });
    store.setSignedIn(true, 'user_a');
    await store.load();
    const seen: boolean[] = [];
    store.subscribe(() => seen.push(store.has('p9')));

    const pending = store.toggle({ ...DRAFT, productId: 'p9' });
    expect(store.has('p9')).toBe(true); // optimistic, server not resolved yet
    gate.resolve();
    expect(await pending).toEqual({ ok: true, saved: true });
    expect(deps.save).toHaveBeenCalledWith({ ...DRAFT, productId: 'p9' });
    expect(store.has('p9')).toBe(true);
    expect(seen[0]).toBe(true);
  });

  it('unsaves an already-saved product via remove()', async () => {
    const { store, deps } = makeStore();
    store.setSignedIn(true, 'user_a');
    await store.load();
    expect(await store.toggle(DRAFT)).toEqual({ ok: true, saved: false });
    expect(deps.remove).toHaveBeenCalledWith('p1');
    expect(store.has('p1')).toBe(false);
  });

  it('rolls back the optimistic save when the server call fails', async () => {
    const { store } = makeStore({ save: vi.fn(async () => { throw new Error('boom'); }) });
    store.setSignedIn(true, 'user_a');
    await store.load();
    const result = await store.toggle({ ...DRAFT, productId: 'p9' });
    expect(result).toEqual({ ok: false, saved: false, reason: 'error' });
    expect(store.has('p9')).toBe(false);
  });

  it('rolls back the optimistic unsave when the server call fails', async () => {
    const { store } = makeStore({ remove: vi.fn(async () => { throw new Error('boom'); }) });
    store.setSignedIn(true, 'user_a');
    await store.load();
    const result = await store.toggle(DRAFT);
    expect(result).toEqual({ ok: false, saved: true, reason: 'error' });
    expect(store.has('p1')).toBe(true);
  });

  it('ignores a second tap while the first toggle for that product is in flight', async () => {
    const gate = deferred();
    const { store, deps } = makeStore({ save: vi.fn(() => gate.promise) });
    store.setSignedIn(true, 'user_a');
    await store.load();
    const first = store.toggle({ ...DRAFT, productId: 'p9' });
    const second = await store.toggle({ ...DRAFT, productId: 'p9' });
    expect(second).toMatchObject({ ok: false, reason: 'busy' });
    gate.resolve();
    await first;
    expect(deps.save).toHaveBeenCalledTimes(1);
  });

  it('keeps an in-flight optimistic save when a slower batch load lands after it', async () => {
    const load = deferred<Array<{ type: string; targetId: string }>>();
    const save = deferred();
    const { store } = makeStore({ fetchSaved: vi.fn(() => load.promise), save: vi.fn(() => save.promise) });
    store.setSignedIn(true, 'user_a'); // kicks off the batch load
    const toggling = store.toggle({ ...DRAFT, productId: 'p9' });
    load.resolve([{ type: 'product', targetId: 'p1' }]); // snapshot predates the tap
    await Promise.resolve(); await Promise.resolve();
    expect(store.has('p9')).toBe(true);
    expect(store.has('p1')).toBe(true);
    save.resolve();
    await toggling;
  });

  it('clears everything on sign-out and on account switch', async () => {
    const { store, deps } = makeStore();
    store.setSignedIn(true, 'user_a');
    await store.load();
    expect(store.has('p1')).toBe(true);
    store.setSignedIn(false, null);
    expect(store.has('p1')).toBe(false);
    expect(store.isLoaded()).toBe(false);
    store.setSignedIn(true, 'user_b');
    await store.load();
    expect(deps.fetchSaved).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale response from the previous account repopulate the cache', async () => {
    const stale = deferred<Array<{ type: string; targetId: string }>>();
    const { store } = makeStore({
      fetchSaved: vi.fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(async () => [{ type: 'product', targetId: 'mine' }]),
    });
    store.setSignedIn(true, 'user_a');
    store.setSignedIn(true, 'user_b');
    stale.resolve([{ type: 'product', targetId: 'theirs' }]);
    await store.load();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has('theirs')).toBe(false);
    expect(store.has('mine')).toBe(true);
  });

  it('swallows a failed batch load and leaves hearts unsaved', async () => {
    const { store } = makeStore({ fetchSaved: vi.fn(async () => { throw new Error('offline'); }) });
    store.setSignedIn(true, 'user_a');
    await store.load();
    expect(store.size()).toBe(0);
    expect(store.isLoaded()).toBe(false);
  });

  it('markSaved (collection sheet) flips the heart without another server call', async () => {
    const { store, deps } = makeStore();
    store.setSignedIn(true, 'user_a');
    await store.load();
    store.markSaved('p77');
    expect(store.has('p77')).toBe(true);
    expect(deps.save).not.toHaveBeenCalled();
  });
});

describe('save heart wiring', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('places the heart on search, discover, shop-profile and product-detail surfaces', () => {
    for (const file of [
      'components/search/ProductTile.tsx',
      'components/discover/EditorialTile.tsx',
      'components/profile/ProfileProductTile.tsx',
      'app/buyer-product-detail.tsx',
    ]) {
      expect(read(file), file).toContain('<SaveHeart');
    }
  });

  it('keeps the heart out of the card Pressable (sibling, not nested)', () => {
    for (const file of ['components/search/ProductTile.tsx', 'components/discover/EditorialTile.tsx']) {
      const src = read(file);
      expect(src.indexOf('</Pressable>'), file).toBeGreaterThan(-1);
      expect(src.indexOf('<SaveHeart'), file).toBeGreaterThan(src.indexOf('</Pressable>'));
    }
  });

  it('shows Recently viewed on Discover below the grid, cart usage untouched', () => {
    expect(read('app/(buyer)/discover.tsx')).toContain('<RecentlyViewedRow');
    expect(read('app/(buyer)/cart.tsx')).toContain('<RecentlyViewedRow style={{ marginTop: SP.xl }} />');
  });

  it('mounts the heart host once at the root', () => {
    expect(read('app/_layout.tsx')).toContain('<SaveHeartHost />');
  });
});
