import { describe, expect, it } from 'vitest';
import { buildFeaturedReturnUrl, featuredStateLabel } from '@/services/featuredSlotService';

describe('featuredSlotService', () => {
  it('builds the deep link and web return URLs the server allowlist expects', () => {
    const id = '0b9f3c1e-6a47-4f43-8d5c-1f7a2f1d9e10';
    expect(buildFeaturedReturnUrl(id)).toBe(`brandthread://featured-slot/?id=${id}&paymentReturn=1`);
    expect(buildFeaturedReturnUrl(id, 'https://app.example.com')).toBe(`https://app.example.com/featured-slot?id=${id}&paymentReturn=1`);
  });

  it('labels every seller-facing state', () => {
    expect(featuredStateLabel('in_review')).toBe('In review');
    expect(featuredStateLabel('live')).toBe('Live');
    expect(featuredStateLabel('rejected')).toBe('Rejected');
    expect(featuredStateLabel('ended')).toBe('Ended');
  });
});
