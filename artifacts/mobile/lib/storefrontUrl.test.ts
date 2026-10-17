import { describe, expect, it } from 'vitest';
import { buildStorefrontSiteUrl, displayUrl, normalizeStoreSlug, resolveShareStoreLink } from './storefrontUrl';

const API = 'https://brandthread.app';

describe('normalizeStoreSlug', () => {
  it.each([
    ['yourbrand', 'yourbrand'],
    ['yourbrand.brandthread.app', 'yourbrand'],
    ['yourbrand.brandthread.app.brandthread.app', 'yourbrand'],
    ['https://YourBrand.brandthread.app/', 'yourbrand'],
    ['http://www.yourbrand.brandthread.app', 'yourbrand'],
    ['https://brandthread.app/store/nova?x=1', 'nova'],
    ['https://brandthread.app/api/store/site/store-1a2b3c4d', 'store-1a2b3c4d'],
    ['@nova', 'nova'],
    ['store-1a2b3c4d', 'store-1a2b3c4d'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeStoreSlug(raw)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', 'brandthread.app', 'https://brandthread.app', 'bad slug', '-x'])('rejects %s', (raw) => {
    expect(normalizeStoreSlug(raw as string | null | undefined)).toBeNull();
  });
});

describe('buildStorefrontSiteUrl', () => {
  it('builds the public site route the API serves', () => {
    expect(buildStorefrontSiteUrl('store-1a2b3c4d', API)).toBe('https://brandthread.app/api/store/site/store-1a2b3c4d');
  });

  it('never doubles the domain suffix', () => {
    const url = buildStorefrontSiteUrl('yourbrand.brandthread.app', `${API}/`);
    expect(url).toBe('https://brandthread.app/api/store/site/yourbrand');
    expect(url).not.toContain('brandthread.app.brandthread.app');
  });

  it('returns null without a valid slug or base', () => {
    expect(buildStorefrontSiteUrl(null, API)).toBeNull();
    expect(buildStorefrontSiteUrl('nova', '')).toBeNull();
    expect(buildStorefrontSiteUrl('nova', 'https://undefined'.replace('https://', ''))).toBeNull();
  });

  it('displayUrl strips the protocol', () => {
    expect(displayUrl('https://brandthread.app/api/store/site/nova')).toBe('brandthread.app/api/store/site/nova');
  });
});

describe('resolveShareStoreLink', () => {
  const base = { apiBaseUrl: API, shareOrigin: 'https://brandthread.app' };

  it('uses the seller username when present', () => {
    expect(resolveShareStoreLink({ ...base, username: '@Nova_Goods', storefront: null }))
      .toEqual({ url: 'https://brandthread.app/store/nova_goods', label: '@nova_goods', kind: 'username' });
  });

  it('uses the own published storefront slug when there is no username', () => {
    const link = resolveShareStoreLink({ ...base, username: null, storefront: { slug: 'store-1a2b3c4d', status: 'published' } });
    expect(link).toMatchObject({ url: 'https://brandthread.app/api/store/site/store-1a2b3c4d', kind: 'storefront' });
  });

  it('never falls back to a guessable value (brand name, "/@", defaults)', () => {
    for (const username of [null, undefined, '', '  ', '@']) {
      const link = resolveShareStoreLink({ ...base, username, storefront: { slug: 'store-1a2b3c4d', status: 'draft' } });
      expect(link.url).toBeNull();
      if (link.url === null) expect(link.reason).toMatch(/username/i);
    }
    expect(resolveShareStoreLink({ ...base, username: null, storefront: null }).url).toBeNull();
  });
});
