import { describe, expect, it } from 'vitest';
import { buyerProductHref, dropsOnLabel, upcomingDropRelease } from './dropProductContext';

describe('dropProductContext', () => {
  it('builds a product href carrying the drop release time', () => {
    const href = buyerProductHref({ id: 'p 1', name: 'Tee & Co' }, { releaseAt: '2030-01-02T10:00:00.000Z', name: 'Spring' });
    expect(href.startsWith('/buyer-product-detail?')).toBe(true);
    const qs = new URLSearchParams(href.split('?')[1]);
    expect(qs.get('productId')).toBe('p 1');
    expect(qs.get('productName')).toBe('Tee & Co');
    expect(qs.get('dropReleaseAt')).toBe('2030-01-02T10:00:00.000Z');
    expect(qs.get('dropName')).toBe('Spring');
  });

  it('omits drop params without a drop', () => {
    expect(buyerProductHref({ id: 'p', name: 'n' })).not.toContain('dropReleaseAt');
  });

  it('only treats future release times as upcoming', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(upcomingDropRelease('2026-01-02T00:00:00Z', now)).toBeInstanceOf(Date);
    expect(upcomingDropRelease('2025-12-31T00:00:00Z', now)).toBeNull();
    expect(upcomingDropRelease('not a date', now)).toBeNull();
    expect(upcomingDropRelease(undefined, now)).toBeNull();
  });

  it('formats a readable label', () => {
    expect(dropsOnLabel(new Date('2026-03-05T15:30:00'))).toMatch(/Mar 5 at 3:30/);
  });
});
