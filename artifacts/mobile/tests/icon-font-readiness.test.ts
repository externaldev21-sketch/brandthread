import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  loaded: new Set<string>(),
  load: vi.fn(),
  platform: { OS: 'web' },
  assets: { feather: 1, material: 2, ionicons: 3, 'material-community': 4, FontAwesome: 5, 'FontAwesome6Brands-Regular': 6 },
}));
vi.mock('expo-font', () => ({
  FontDisplay: { BLOCK: 'block' },
  isLoaded: (name: string) => fake.loaded.has(name),
  loadAsync: fake.load,
}));
vi.mock('react-native', () => ({ Platform: fake.platform }));
vi.mock('@/lib/iconFontAssets', () => ({ ICON_FONT_ASSETS: fake.assets }));

type Face = { family: string; status: string };
function browserFonts(faces: Face[] = []) {
  const fonts = Object.assign(new Set(faces), {
    check: vi.fn(() => true),
    load: vi.fn(async () => faces),
    addEventListener: vi.fn((_type: string, _listener: () => void) => {}),
  });
  vi.stubGlobal('document', { fonts });
  return fonts;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  fake.loaded.clear();
  fake.platform.OS = 'web';
  fake.load.mockReset().mockResolvedValue(undefined);
  browserFonts();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bundled icon font readiness', () => {
  it('preloads only the six used families with block display, once', async () => {
    const fonts = await import('@/lib/iconFonts');
    const first = fonts.preloadIconFonts();
    expect(fonts.preloadIconFonts()).toBe(first);
    await first;
    expect(fake.load).toHaveBeenCalledTimes(6);
    for (const [name, uri] of Object.entries(fake.assets)) {
      expect(fake.load).toHaveBeenCalledWith(name, { uri, display: 'block' });
    }
    expect(fonts.getIconFontBootReady()).toBe(true);
  });

  it('does not trust Expo registry success while the browser face is loading', async () => {
    const face = { family: '"feather"', status: 'loading' };
    const browser = browserFonts([face]);
    fake.loaded.add('feather');
    const fonts = await import('@/lib/iconFonts');
    expect(fonts.isIconFontReady('feather')).toBe(false);
    face.status = 'loaded';
    expect(fonts.isIconFontReady('feather')).toBe(true);
    browser.check.mockReturnValue(false);
    expect(fonts.isIconFontReady('feather')).toBe(false);
  });

  it('rejects a missing face even when document.fonts.check returns true', async () => {
    fake.loaded.add('feather');
    const fonts = await import('@/lib/iconFonts');
    expect(fonts.isIconFontReady('feather')).toBe(false);
    expect(fonts.isBundledIconFont('unused-family')).toBe(false);
  });

  it('does not strand the splash on a slow font and still observes late completion', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    fake.load.mockReturnValue(pending);
    const fonts = await import('@/lib/iconFonts');
    const listener = vi.fn();
    const unsubscribe = fonts.subscribeIconFonts(listener);
    const loading = fonts.preloadIconFonts();
    expect(fonts.getIconFontBootReady()).toBe(false);
    await vi.advanceTimersByTimeAsync(2500);
    expect(fonts.getIconFontBootReady()).toBe(true);
    expect(fonts.isIconFontReady('feather')).toBe(false);
    finish();
    await loading;
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('handles genuinely failed fonts without an unhandled rejection or retries', async () => {
    fake.load.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fonts = await import('@/lib/iconFonts');
    await expect(fonts.preloadIconFonts()).resolves.toBeUndefined();
    await fonts.preloadIconFonts();
    expect(fake.load).toHaveBeenCalledTimes(6);
    expect(fonts.getIconFontBootReady()).toBe(true);
    expect(fonts.isIconFontReady('feather')).toBe(false);
  });

  it('publishes browser font events to icon subscribers', async () => {
    const browser = browserFonts();
    const fonts = await import('@/lib/iconFonts');
    const listener = vi.fn();
    const unsubscribe = fonts.subscribeIconFonts(listener);
    await fonts.preloadIconFonts();
    listener.mockClear();
    const callback = browser.addEventListener.mock.calls.find(call => call[0] === 'loadingdone')?.[1] as () => void;
    callback();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    callback();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('uses native registration without requiring a browser FontFaceSet', async () => {
    vi.stubGlobal('document', undefined);
    fake.platform.OS = 'ios';
    fake.loaded.add('feather');
    const fonts = await import('@/lib/iconFonts');
    await fonts.preloadIconFonts();
    expect(fake.load).toHaveBeenCalledTimes(6);
    expect(fonts.isIconFontReady('feather')).toBe(true);
  });

  it('does not start browser asset requests during static HTML generation', async () => {
    vi.stubGlobal('document', undefined);
    const fonts = await import('@/lib/iconFonts');
    await fonts.preloadIconFonts();
    expect(fake.load).not.toHaveBeenCalled();
    expect(fonts.getIconFontServerReady()).toBe(true);
    expect(fonts.getIconFontServerHidden()).toBe(false);
  });
});
