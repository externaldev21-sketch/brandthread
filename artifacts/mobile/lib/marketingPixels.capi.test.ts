import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'generated-uuid') }));
const { conversionEvent } = vi.hoisted(() => ({ conversionEvent: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api', () => ({ api: { metaAds: { conversionEvent } } }));

import { resetMarketingPixelsForTest, setMarketingPixelConsent, trackAndRelayConversionEvent } from './marketingPixels';

describe('CAPI relay carries every product so the server credits each seller (BT-325)', () => {
  beforeEach(() => {
    resetMarketingPixelsForTest();
    conversionEvent.mockClear();
    (globalThis as any).window = { fbq: () => {} };
    (globalThis as any).document = { createElement: () => ({}), head: { appendChild: () => {} } };
  });

  it('sends the order content_ids as productIds (deduped)', () => {
    setMarketingPixelConsent(true, { metaPixelId: '1234567890' });
    trackAndRelayConversionEvent('Purchase', { value: 90, content_ids: ['a', 'b', 'a', 7] }, { valueCents: 9000 });
    expect(conversionEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'Purchase', productIds: ['a', 'b'] }));
  });

  it('sends nothing without marketing consent', () => {
    expect(trackAndRelayConversionEvent('ViewContent', { content_ids: ['a'] }, { productId: 'a' })).toBe(false);
    expect(conversionEvent).not.toHaveBeenCalled();
  });
});
