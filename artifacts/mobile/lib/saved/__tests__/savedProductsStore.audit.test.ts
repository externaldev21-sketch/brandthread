import { describe, expect, it, vi } from 'vitest';
import { createSavedProductsStore } from '../savedProductsStore';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('saved products store: list read racing a toggle (audit)', () => {
  it('keeps a save that finished while an older list read was in flight', async () => {
    const first = deferred<Array<{ type: string; targetId: string }>>();
    const fetchSaved = vi.fn()
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(() => first.promise);
    const store = createSavedProductsStore({ fetchSaved, save: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) });
    store.setSignedIn(true, 'u1');
    await flush();
    expect(store.isLoaded()).toBe(true);

    // A refresh starts; its snapshot is taken before the save below.
    const refreshing = store.refresh();
    await store.toggle({ productId: 'p9', title: 'Jacket' });
    expect(store.has('p9')).toBe(true);

    first.resolve([]); // the server list from before the save
    await refreshing;
    expect(store.has('p9')).toBe(true);
  });

  it('keeps an unsave that finished while an older list read was in flight', async () => {
    const second = deferred<Array<{ type: string; targetId: string }>>();
    const fetchSaved = vi.fn()
      .mockImplementationOnce(async () => [{ type: 'product', targetId: 'p1' }])
      .mockImplementationOnce(() => second.promise);
    const store = createSavedProductsStore({ fetchSaved, save: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) });
    store.setSignedIn(true, 'u1');
    await flush();
    expect(store.has('p1')).toBe(true);

    const refreshing = store.refresh();
    await store.toggle({ productId: 'p1', title: 'Tee' });
    expect(store.has('p1')).toBe(false);

    second.resolve([{ type: 'product', targetId: 'p1' }]);
    await refreshing;
    expect(store.has('p1')).toBe(false);
  });

  it('still takes the server list for products nobody touched', async () => {
    const second = deferred<Array<{ type: string; targetId: string }>>();
    const fetchSaved = vi.fn()
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(() => second.promise);
    const store = createSavedProductsStore({ fetchSaved, save: vi.fn(async () => ({})), remove: vi.fn(async () => ({})) });
    store.setSignedIn(true, 'u1');
    await flush();
    const refreshing = store.refresh();
    await store.toggle({ productId: 'p9', title: 'Jacket' });
    second.resolve([{ type: 'product', targetId: 'p5' }]);
    await refreshing;
    expect(store.has('p5')).toBe(true);
    expect(store.has('p9')).toBe(true);
  });
});
