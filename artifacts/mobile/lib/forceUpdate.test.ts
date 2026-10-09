import { describe, expect, it, vi } from 'vitest';
import { createAppConfigLoader, parseAppConfig, type AppConfig } from './appConfig';
import { requiredUpdateUrl, resolveStoreUrl } from './forceUpdate';

const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  minSupportedVersion: { ios: '1.2.0', android: '1.2.0' },
  latestVersion: null,
  storeUrls: { ios: 'https://apps.apple.com/app/id123456789', android: null },
  flags: {},
  criticalUpdateIds: [],
  ...overrides,
});

const base = { platform: 'ios', isDev: false, gateEnabled: true, currentVersion: '1.1.9', config: config() };

describe('requiredUpdateUrl', () => {
  it('blocks an older native build with the store URL', () => {
    expect(requiredUpdateUrl(base)).toBe('https://apps.apple.com/app/id123456789');
    expect(requiredUpdateUrl({ ...base, platform: 'android' })).toBe(
      'https://play.google.com/store/apps/details?id=com.brandthread.mobile',
    );
  });

  it('never blocks on web, in development, with the gate off, or without a config', () => {
    expect(requiredUpdateUrl({ ...base, platform: 'web' })).toBeNull();
    expect(requiredUpdateUrl({ ...base, isDev: true })).toBeNull();
    expect(requiredUpdateUrl({ ...base, gateEnabled: false })).toBeNull();
    expect(requiredUpdateUrl({ ...base, config: null })).toBeNull();
  });

  it('does not block the same or a newer version, or when nothing is configured', () => {
    expect(requiredUpdateUrl({ ...base, currentVersion: '1.2.0' })).toBeNull();
    expect(requiredUpdateUrl({ ...base, currentVersion: '1.10.0' })).toBeNull();
    expect(requiredUpdateUrl({ ...base, config: config({ minSupportedVersion: { ios: null, android: null } }) })).toBeNull();
  });

  it('fails open when the running version is unknown', () => {
    expect(requiredUpdateUrl({ ...base, currentVersion: undefined })).toBeNull();
    expect(requiredUpdateUrl({ ...base, currentVersion: 'dev' })).toBeNull();
  });

  it('does not show a dead-end screen when no iOS store URL is known', () => {
    const noUrl = config({ storeUrls: { ios: null, android: null } });
    expect(requiredUpdateUrl({ ...base, config: noUrl })).toBeNull();
    expect(requiredUpdateUrl({ ...base, config: noUrl, iosAppStoreId: '987654321' })).toBe('https://apps.apple.com/app/id987654321');
  });
});

describe('resolveStoreUrl', () => {
  it('prefers the server URL, then the build id / package', () => {
    expect(resolveStoreUrl({ platform: 'android', config: config({ storeUrls: { ios: null, android: 'market://details?id=x.y' } }) })).toBe('market://details?id=x.y');
    expect(resolveStoreUrl({ platform: 'android', config: null, androidPackage: 'com.example.app' })).toBe(
      'https://play.google.com/store/apps/details?id=com.example.app',
    );
    expect(resolveStoreUrl({ platform: 'ios', config: null, iosAppStoreId: 'abc' })).toBeNull();
    expect(resolveStoreUrl({ platform: 'web', config: config() })).toBeNull();
  });
});

describe('parseAppConfig', () => {
  it('normalises a server response', () => {
    expect(parseAppConfig({
      minSupportedVersion: { ios: '1.0.0', android: 7 },
      latestVersion: '1.3.0',
      storeUrls: { ios: 'javascript:alert(1)', android: 'https://play.google.com/store/apps/details?id=a.b' },
      flags: { a: true, b: 'yes' },
      criticalUpdateIds: ['id-1', 2],
    })).toEqual({
      minSupportedVersion: { ios: '1.0.0', android: null },
      latestVersion: '1.3.0',
      storeUrls: { ios: null, android: 'https://play.google.com/store/apps/details?id=a.b' },
      flags: { a: true },
      criticalUpdateIds: ['id-1'],
    });
    expect(parseAppConfig(null)).toBeNull();
    expect(parseAppConfig([1])).toBeNull();
  });
});

describe('createAppConfigLoader', () => {
  const okResponse = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

  it('throttles network requests and shares one in-flight request', async () => {
    let t = 0;
    const fetchImpl = vi.fn(async (_url: string) => okResponse({ minSupportedVersion: { ios: '1.0.0' } }));
    const loader = createAppConfigLoader({ baseUrl: 'https://api.example.com/', fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, minRefreshMs: 1000 });
    const [a, b] = await Promise.all([loader.load({ force: true }), loader.load()]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/api/v1/app/config');
    t = 500;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t = 1500;
    await loader.load();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('resolves null on failure, timeout-style rejections and bad status', async () => {
    const failing = createAppConfigLoader({ baseUrl: 'https://x', fetchImpl: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await failing.load({ force: true })).toBeNull();
    const bad = createAppConfigLoader({ baseUrl: 'https://x', fetchImpl: vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) });
    expect(await bad.load({ force: true })).toBeNull();
    const noBase = createAppConfigLoader({ baseUrl: '', fetchImpl: vi.fn() });
    expect(await noBase.load({ force: true })).toBeNull();
  });

  it('notifies subscribers on success only', async () => {
    const listener = vi.fn();
    const loader = createAppConfigLoader({ baseUrl: 'https://x', fetchImpl: vi.fn(async () => okResponse({ flags: { a: true } })) });
    const unsubscribe = loader.subscribe(listener);
    await loader.load({ force: true });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ flags: { a: true } }));
    unsubscribe();
    await loader.load({ force: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
