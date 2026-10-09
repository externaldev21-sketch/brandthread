import { describe, expect, it } from 'vitest';

import { displayStoreLink, sellerStoreLink } from './storeShare';

describe('sellerStoreLink', () => {
  it('builds the one storefront link from a valid username', () => {
    expect(sellerStoreLink('@Northline')).toBe('https://brandthread.app/u/northline');
  });

  it('gives no link without a valid username (never an invented slug)', () => {
    expect(sellerStoreLink(null)).toBeNull();
    expect(sellerStoreLink('ab')).toBeNull();
    expect(sellerStoreLink('')).toBeNull();
  });

  it('displays without the scheme', () => {
    expect(displayStoreLink('https://brandthread.app/u/northline')).toBe('brandthread.app/u/northline');
  });
});
