import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePreviewRole } from '../lib/previewRoleSelection';

const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('react-native', () => ({ Platform: platform }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  platform.OS = 'web';
});

describe('explicit development preview', () => {
  it('defaults to guest and preserves explicit seller selection', () => {
    expect(resolvePreviewRole('', null)).toBe(null);
    expect(resolvePreviewRole('', 'invalid')).toBe(null);
    expect(resolvePreviewRole('?bt_preview=guest', 'seller')).toBe(null);
    expect(resolvePreviewRole('?bt_preview=seller', null)).toBe('seller');
    expect(resolvePreviewRole('', 'seller')).toBe('seller');
    expect(resolvePreviewRole('?bt_preview=buyer', 'seller')).toBe('buyer');
  });

  it('ignores retired automatic-role keys and persists only an explicit review selection', async () => {
    vi.stubGlobal('__DEV__', true);
    const entries = new Map([['bt:previewRole:seller-default', 'seller'], ['bt:previewRole:buyer-default', 'buyer']]);
    vi.stubGlobal('window', {
      location: { search: '', hostname: 'localhost' },
      localStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
        removeItem: (key: string) => entries.delete(key),
      },
    });
    const preview = await import('../lib/devPreview');
    expect(preview.getDevWebPreviewRole()).toBe(null);
    window.location.search = '?bt_preview=seller';
    expect(preview.getDevWebPreviewRole()).toBe('seller');
    expect(entries.get('bt:previewRole:explicit-v1')).toBe('seller');
    window.location.search = '';
    expect(preview.getDevWebPreviewRole()).toBe('seller');
    expect(preview.isPreviewDemoMode()).toBe(false);
  });

  it.each([true, false])('restores explicit roles across loads, clears for guest, and keeps demo URL-only (dev=%s)', async (isDev) => {
    vi.stubGlobal('__DEV__', isDev);
    vi.stubEnv('EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST', '1');
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    };
    const load = (search: string, hostname = 'localhost') => {
      vi.stubGlobal('window', { location: { search, hostname }, localStorage: storage });
    };
    load('?bt_preview=buyer&demo=1');
    let preview = await import('../lib/devPreview');
    expect(preview.isBuyerDevPreview()).toBe(true);
    expect(entries.get('bt:previewRole:explicit-v1')).toBe('buyer');
    // A fresh tab/module instance keeps localStorage, not sessionStorage.
    vi.resetModules();
    load('');
    preview = await import('../lib/devPreview');
    expect(preview.getDevWebPreviewRole()).toBe('buyer');
    expect(preview.isBuyerDevPreview()).toBe(true);
    expect(preview.isSellerDevPreview()).toBe(false);
    expect(preview.isPreviewDemoMode()).toBe(false);
    load('?bt_preview=seller');
    expect(preview.isSellerDevPreview()).toBe(true);
    expect(entries.get('bt:previewRole:explicit-v1')).toBe('seller');
    load('?bt_preview=guest');
    expect(preview.isBuyerDevPreview()).toBe(false);
    expect(preview.isSellerDevPreview()).toBe(false);
    expect(entries.has('bt:previewRole:explicit-v1')).toBe(false);
    load('');
    expect(preview.getDevWebPreviewRole()).toBe(null);
    load('?bt_preview=buyer');
    expect(preview.isBuyerDevPreview()).toBe(true);
    entries.clear();
    load('');
    expect(preview.getDevWebPreviewRole()).toBe(null);
    entries.set('bt:previewRole:explicit-v1', 'buyer');
    load('?bt_preview=seller', 'brandthread.app');
    expect(preview.isBuyerDevPreview()).toBe(false);
    expect(preview.isSellerDevPreview()).toBe(false);
    expect(entries.get('bt:previewRole:explicit-v1')).toBe('buyer');
  });

  it('ignores saved roles in a real production build even on a different host', async () => {
    vi.stubGlobal('__DEV__', false);
    vi.stubEnv('EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST', '');
    vi.stubGlobal('window', {
      location: { search: '?bt_preview=buyer', hostname: 'example.com' },
      localStorage: { getItem: () => 'buyer' },
    });
    const preview = await import('../lib/devPreview');
    expect(preview.getDevWebPreviewRole()).toBe(null);
    expect(preview.isBuyerDevPreview()).toBe(false);
    expect(preview.isSellerDevPreview()).toBe(false);
  });

  it('enables native buyer only in development, never in a release', async () => {
    vi.stubGlobal('__DEV__', true);
    const { resolveDevBuyerPreview, resolveDevSellerPreview } = await import('../lib/buildFlags');
    expect(resolveDevBuyerPreview(true, false, 'buyer')).toBe(true);
    expect(resolveDevBuyerPreview(true, false, 'seller')).toBe(false);
    expect(resolveDevBuyerPreview(false, true, 'buyer')).toBe(false);
    expect(resolveDevBuyerPreview(false, false, 'buyer')).toBe(false);
    expect(resolveDevBuyerPreview(true, true, 'buyer')).toBe(false);
    expect(resolveDevSellerPreview(true, false, 'seller')).toBe(true);
  });

  it('routes a native buyer preview without demo data or persistent account writes', async () => {
    vi.stubGlobal('__DEV__', true);
    vi.stubEnv('EXPO_PUBLIC_DEV_PREVIEW', 'buyer');
    vi.stubEnv('EXPO_OS', 'ios');
    platform.OS = 'ios';
    const { DEV_BYPASS_ROLE } = await import('../lib/devBypass');
    const preview = await import('../lib/devPreview');
    expect(DEV_BYPASS_ROLE).toBe('buyer');
    expect(preview.isBuyerDevPreview()).toBe(true);
    expect(preview.isSellerDevPreview()).toBe(false);
    expect(preview.isPreviewDemoMode('?demo=1')).toBe(false);
    expect(preview.isPreviewFreshMode()).toBe(true);
  });

  it('keeps production web preview disabled even with an explicit buyer URL', async () => {
    vi.stubGlobal('__DEV__', true);
    vi.stubGlobal('window', { location: { search: '?bt_preview=buyer', hostname: 'brandthread.app' } });
    const preview = await import('../lib/devPreview');
    expect(preview.getDevWebPreviewRole()).toBe(null);
    expect(preview.isBuyerDevPreview()).toBe(false);
    expect(preview.isSellerDevPreview()).toBe(false);
  });
});
