import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'generated-uuid') }));

const { conversionEvent } = vi.hoisted(() => ({ conversionEvent: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api', () => ({ api: { metaAds: { conversionEvent } } }));

import {
  isConfiguredPixelId,
  resetMarketingPixelsForTest,
  setMarketingPixelConsent,
  trackMarketingPixelEvent,
  trackAndRelayConversionEvent,
} from './marketingPixels';

describe('marketing pixel consent boundary', () => {
  const config = { metaPixelId: '1234567890', tiktokPixelId: 'C123456789ABCDEF' };
  const appendedScripts: Array<{ src?: string }> = [];

  beforeEach(() => {
    resetMarketingPixelsForTest();
    appendedScripts.length = 0;
    conversionEvent.mockClear();
    (globalThis as any).window = {};
    (globalThis as any).document = {
      createElement: () => ({}),
      head: { appendChild: (script: { src?: string }) => appendedScripts.push(script) },
    };
  });

  it('rejects absent, malformed, and placeholder IDs', () => {
    expect(isConfiguredPixelId(undefined, 'meta')).toBe(false);
    expect(isConfiguredPixelId('YOUR_PIXEL_ID', 'meta')).toBe(false);
    expect(isConfiguredPixelId('1234567890', 'meta')).toBe(true);
    expect(isConfiguredPixelId('fake-tiktok-id', 'tiktok')).toBe(false);
    expect(isConfiguredPixelId('C123456789ABCDEF', 'tiktok')).toBe(true);
  });

  it('does not initialize or track before explicit marketing consent', () => {
    expect(setMarketingPixelConsent(false, config)).toBe(false);
    expect(trackMarketingPixelEvent('PageView', {}, config)).toBe(false);
    expect(appendedScripts).toHaveLength(0);
  });

  it('loads configured adapters only after consent and permits approved events', () => {
    expect(setMarketingPixelConsent(true, config)).toBe(true);
    expect(appendedScripts.map((script) => script.src)).toEqual([
      'https://connect.facebook.net/en_US/fbevents.js',
      expect.stringContaining('https://analytics.tiktok.com/i18n/pixel/events.js'),
    ]);
    expect(trackMarketingPixelEvent('PageView', { path: '/' }, config)).toBe(true);
    expect(setMarketingPixelConsent(false, config)).toBe(true);
    expect(trackMarketingPixelEvent('Purchase', { value: 10 }, config)).toBe(false);
    expect(setMarketingPixelConsent(true, config)).toBe(true);
    expect(trackMarketingPixelEvent('Purchase', { value: 10 }, config)).toBe(true);
  });
});

describe('trackAndRelayConversionEvent', () => {
  const config = { metaPixelId: '1234567890', tiktokPixelId: 'C123456789ABCDEF' };
  let fbqCalls: unknown[][] = [];

  beforeEach(() => {
    resetMarketingPixelsForTest();
    conversionEvent.mockClear();
    fbqCalls = [];
    // trackAndRelayConversionEvent (unlike trackMarketingPixelEvent) always
    // resolves its pixel config from env, mirroring the caller pattern used
    // throughout product/checkout screens — so stub env here instead of
    // passing a `config` override.
    vi.stubEnv('EXPO_PUBLIC_META_PIXEL_ID', config.metaPixelId);
    vi.stubEnv('EXPO_PUBLIC_TIKTOK_PIXEL_ID', config.tiktokPixelId);
    const win: any = {};
    win.fbq = (...args: unknown[]) => { fbqCalls.push(args); };
    (globalThis as any).window = win;
    (globalThis as any).document = { createElement: () => ({}), head: { appendChild: () => {} } };
  });

  it('does nothing without marketing consent', async () => {
    expect(setMarketingPixelConsent(false, config)).toBe(false);
    const result = trackAndRelayConversionEvent('AddToCart', { value: 20 }, { productId: 'p1' });
    expect(result).toBe(false);
    expect(fbqCalls).toHaveLength(0);
    expect(conversionEvent).not.toHaveBeenCalled();
  });

  it('fires the pixel and relays the same eventId to the server, once consent is granted', () => {
    expect(setMarketingPixelConsent(true, config)).toBe(true);
    const result = trackAndRelayConversionEvent('Purchase', { value: 42 }, {
      eventId: 'evt-123', productId: 'p1', valueCents: 4200, currency: 'usd',
    });
    expect(result).toBe(true);

    // Pixel call used the same eventId as the 4th positional arg.
    const trackCall = fbqCalls.find((c) => c[0] === 'track');
    expect(trackCall).toEqual(['track', 'Purchase', { value: 42 }, { eventID: 'evt-123' }]);

    // Server relay carried the same eventId.
    expect(conversionEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt-123',
      eventName: 'Purchase',
      productId: 'p1',
      valueCents: 4200,
      currency: 'usd',
    }));
  });

  it('generates an eventId when the caller does not supply one', () => {
    expect(setMarketingPixelConsent(true, config)).toBe(true);
    trackAndRelayConversionEvent('ViewContent', {}, { productId: 'p2' });
    const trackCall = fbqCalls.find((c) => c[0] === 'track');
    expect((trackCall?.[3] as any)?.eventID).toBe('generated-uuid');
    expect(conversionEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'generated-uuid' }));
  });
});