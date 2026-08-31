import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import {
  isConfiguredPixelId,
  resetMarketingPixelsForTest,
  setMarketingPixelConsent,
  trackMarketingPixelEvent,
} from './marketingPixels';

describe('marketing pixel consent boundary', () => {
  const config = { metaPixelId: '1234567890', tiktokPixelId: 'C123456789ABCDEF' };
  const appendedScripts: Array<{ src?: string }> = [];

  beforeEach(() => {
    resetMarketingPixelsForTest();
    appendedScripts.length = 0;
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