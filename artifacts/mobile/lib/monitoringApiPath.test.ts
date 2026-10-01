import { describe, expect, it } from 'vitest';
import { normalizeApiPath } from './monitoringConfig';

describe('normalizeApiPath', () => {
  it('drops query strings and replaces ids so no record or account id is reported', () => {
    expect(normalizeApiPath('/api/v1/orders/123456?token=abc')).toBe('/api/v1/orders/:id');
    expect(normalizeApiPath('/api/posts/3f2b8c1e-aaaa-4bbb-8ccc-1234567890ab/watched')).toBe('/api/posts/:id/watched');
    expect(normalizeApiPath('/api/social/follow/user_2abcDEF')).toBe('/api/social/follow/:id');
  });
  it('keeps plain route names', () => {
    expect(normalizeApiPath('/api/buyer/cart')).toBe('/api/buyer/cart');
  });
});
