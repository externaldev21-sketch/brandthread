import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isStoreHost, storefrontRedirectTarget } = require('./storefrontRedirects');

describe('storefront addresses on the web domain', () => {
  it('sends the Share Store link and the DNS-free path to the API storefront pages', () => {
    expect(storefrontRedirectTarget({ host: 'brandthread.app', pathname: '/store/northline' }))
      .toBe('/api/store/by-username/northline');
    expect(storefrontRedirectTarget({ host: 'brandthread.app', pathname: '/store/@northline/' }))
      .toBe('/api/store/by-username/northline');
    expect(storefrontRedirectTarget({ host: 'brandthread.app', pathname: '/s/store-ab12' }))
      .toBe('/api/store/site/store-ab12');
  });

  it("serves a store's own host at its root", () => {
    expect(storefrontRedirectTarget({ host: 'northline.brandthread.app', pathname: '/' })).toBe('/api/store/host-site');
    expect(storefrontRedirectTarget({ host: 'shop.northline.com:443', pathname: '/' })).toBe('/api/store/host-site');
  });

  it('never treats the app itself as a store', () => {
    for (const host of ['brandthread.app', 'www.brandthread.app', 'api.brandthread.app', 'brandthread.replit.app',
      'abc-123.picard.replit.dev', 'localhost', '127.0.0.1', '']) {
      expect(isStoreHost(host)).toBe(false);
    }
    expect(storefrontRedirectTarget({ host: 'brandthread.app', pathname: '/' })).toBeNull();
    expect(storefrontRedirectTarget({ host: 'brandthread.app', pathname: '/store-builder' })).toBeNull();
    expect(storefrontRedirectTarget({ host: 'northline.brandthread.app', pathname: '/settings' })).toBeNull();
  });
});
