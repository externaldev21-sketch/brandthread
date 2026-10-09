import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('../lib/buildFlags', () => ({
  DEV_SELLER_PREVIEW: true,
  NAVIGATION_ISOLATION_TEST: true,
}));
import {
  clearStoredPreviewDemo, isPreviewDemoMode, isPreviewFreshMode, isSellerDevPreview,
} from '../lib/devPreview';

let stored: Map<string, string>;
beforeEach(() => {
  platform.OS = 'web';
  stored = new Map([['bt_preview_demo', '1']]);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => stored.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
    removeItem: vi.fn((key: string) => stored.delete(key)),
  });
  vi.stubGlobal('window', {
    location: { search: '?bt_preview=seller', hostname: 'localhost' },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('demo is explicit, web-only and never sticky', () => {
  it('does not interpret the native seller bypass as a request for demo fixtures', () => {
    platform.OS = 'ios';
    expect(isSellerDevPreview()).toBe(true);
    expect(isPreviewDemoMode()).toBe(false);
    expect(isPreviewDemoMode('?bt_preview=seller&demo=1')).toBe(false);
    expect(isPreviewFreshMode()).toBe(true);
    platform.OS = 'android';
    expect(isPreviewDemoMode('?demo=1')).toBe(false);
    expect(isPreviewFreshMode()).toBe(true);
  });
  it('ignores legacy persisted demo state and clears it on startup', () => {
    expect(isPreviewDemoMode()).toBe(false);
    expect(isPreviewFreshMode()).toBe(true);
    clearStoredPreviewDemo();
    expect(stored.has('bt_preview_demo')).toBe(false);
  });
  it('enables demo only on the URL that explicitly requests it', () => {
    window.location.search = '?bt_preview=seller&demo=1';
    expect(isPreviewDemoMode()).toBe(true);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    window.location.search = '';
    expect(isPreviewDemoMode()).toBe(false);
    expect(isPreviewFreshMode()).toBe(true);
    window.location.search = '?bt_preview=seller';
    expect(isPreviewDemoMode()).toBe(false);
  });
  it.each(['?demo=0', '?demo=true', '?demo=', ''])('stays empty for %s', search => {
    expect(isPreviewDemoMode(search)).toBe(false);
  });
  it('remains disabled on a production host even when flags and demo=1 are present', () => {
    window.location.hostname = 'brandthread.app';
    window.location.search = '?bt_preview=seller&demo=1';
    expect(isPreviewDemoMode()).toBe(false);
  });
  it('does not depend on storage being available', () => {
    vi.stubGlobal('localStorage', { removeItem: () => { throw new Error('disabled'); } });
    expect(() => clearStoredPreviewDemo()).not.toThrow();
    expect(isPreviewDemoMode()).toBe(false);
  });
});
