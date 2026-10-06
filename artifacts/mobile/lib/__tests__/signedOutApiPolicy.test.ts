import { describe, expect, it } from 'vitest';
import probe from './fixtures/signedOutProbe.json';
import { isPublicApiRequest, normalizeApiPath } from '@/lib/signedOutApiPolicy';

// Account-scoped routes the server crashes on (500) instead of answering 401
// when called anonymously. They are not public: keep them blocked.
const ANONYMOUS_500_BUT_PROTECTED = new Set([
  'GET /api/manufacturers/connect/status',
  'POST /api/manufacturers/connect/onboard',
]);

describe('signedOutApiPolicy', () => {
  it('matches what the API server actually serves anonymously, for every lib/api.ts endpoint', () => {
    const wrong: string[] = [];
    for (const [method, path, status] of probe.probes as Array<[string, string, number]>) {
      const key = `${method} ${path}`;
      const expectedPublic = status !== 401 && !ANONYMOUS_500_BUT_PROTECTED.has(key);
      if (isPublicApiRequest(method, path) !== expectedPublic) wrong.push(`${key} (server ${status})`);
    }
    expect(wrong).toEqual([]);
    expect(probe.probes.length).toBeGreaterThan(500);
  });

  it('blocks paid AI helper paths that a prefix denylist let through (QA-0102)', () => {
    for (const path of [
      '/api/ai-helpers/caption',
      '/api/ai-helpers/product-description',
      '/api/v1/ai-helpers/size-chart',
      '/api/ai/chat',
      '/api/posts/abc/captions/generate',
      '/api/posts/abc/captions',
      '/api/products/images',
      '/api/seller/profile/avatar/upload',
      '/api/communities/upload-photo',
      '/api/seller/subscription/checkout',
      '/api/bg-removal/remove',
    ]) {
      expect(isPublicApiRequest('POST', path)).toBe(false);
      expect(isPublicApiRequest('GET', path)).toBe(false);
    }
  });

  it('blocks the account-scoped paths under /public (QA-0010, QA-0055, QA-0065)', () => {
    expect(isPublicApiRequest('POST', '/api/v1/public/sellers/preview-seller/visit')).toBe(false);
    expect(isPublicApiRequest('GET', '/api/v1/public/search/recent?limit=10')).toBe(false);
    expect(isPublicApiRequest('DELETE', '/api/public/search/recent/abc')).toBe(false);
    expect(isPublicApiRequest('GET', '/api/v1/public/drops/demo/notify')).toBe(false);
    // …while the browse surface next to them stays public.
    expect(isPublicApiRequest('GET', '/api/public/search?q=coat')).toBe(true);
    expect(isPublicApiRequest('GET', '/api/public/drops/demo')).toBe(true);
    expect(isPublicApiRequest('POST', '/api/public/sellers/abc/store-visits')).toBe(true);
  });

  it('treats unknown and future routes as protected', () => {
    expect(isPublicApiRequest('GET', '/api/seller/giveaways')).toBe(false);
    expect(isPublicApiRequest('GET', '/api/gift-cards/mine')).toBe(false);
    expect(isPublicApiRequest('GET', '/api/publicity')).toBe(false);
    expect(isPublicApiRequest(undefined, '/api/marketing/email/status')).toBe(false);
  });

  it('only opens read methods where the server only serves reads', () => {
    expect(isPublicApiRequest('GET', '/api/posts/abc')).toBe(true);
    expect(isPublicApiRequest('PATCH', '/api/posts/abc')).toBe(false);
    expect(isPublicApiRequest('DELETE', '/api/posts/abc')).toBe(false);
    expect(isPublicApiRequest('GET', '/api/posts/mine')).toBe(false);
    expect(isPublicApiRequest('POST', '/api/live/abc/join')).toBe(false);
  });

  it('normalizes versioned, query-string and absolute paths', () => {
    expect(normalizeApiPath('/api/v1/public/search?q=a')).toBe('public/search');
    expect(normalizeApiPath('/api/healthz/')).toBe('healthz');
    expect(normalizeApiPath('https://x.test/api/v2/store#top')).toBe('store');
  });
});
