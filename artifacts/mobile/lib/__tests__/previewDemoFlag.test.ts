import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

function fakeStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    has: (k: string) => data.has(k),
  };
}

async function loadPage(search: string, stored: Record<string, string>) {
  const storage = fakeStorage(stored);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { location: { search, hostname: 'localhost' } });
  vi.resetModules();
  await import('../devPreview');
  return storage;
}

describe('preview demo flag', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a page load without demo=1 clears demo mode left over from an earlier visit', async () => {
    const storage = await loadPage('', { bt_preview_demo: '1', user_role: 'seller' });
    expect(storage.has('bt_preview_demo')).toBe(false);
  });

  it('a reload of a preview link without demo=1 lands on fresh data', async () => {
    const storage = await loadPage('?bt_preview=buyer', { bt_preview_demo: '1' });
    expect(storage.has('bt_preview_demo')).toBe(false);
  });

  it('keeps demo mode for the load that asked for it', async () => {
    const storage = await loadPage('?bt_preview=seller&demo=1', { bt_preview_demo: '1' });
    expect(storage.getItem('bt_preview_demo')).toBe('1');
  });
});
