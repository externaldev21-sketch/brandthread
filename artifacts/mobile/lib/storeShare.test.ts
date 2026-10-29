import { describe, expect, it } from 'vitest';

import { displayStoreLink, headerStoreLinkLabel, sellerStoreLink } from './storeShare';

describe('sellerStoreLink', () => {
  it('builds the one storefront link from a valid username', () => {
    expect(sellerStoreLink('@Northline')).toBe('https://brandthread.app/@northline');
  });

  it('gives no link without a valid username (never an invented slug)', () => {
    expect(sellerStoreLink(null)).toBeNull();
    expect(sellerStoreLink('ab')).toBeNull();
    expect(sellerStoreLink('')).toBeNull();
  });

  it('displays without the scheme', () => {
    expect(displayStoreLink('https://brandthread.app/u/northline')).toBe('brandthread.app/u/northline');
    expect(displayStoreLink('https://brandthread.app/@northline')).toBe('brandthread.app/@northline');
  });
});

describe('headerStoreLinkLabel', () => {
  it('shows the whole link when it fits', () => {
    expect(headerStoreLinkLabel('https://brandthread.app/@ava')).toBe('brandthread.app/@ava');
  });
  it('keeps the full @username when the link is too long', () => {
    expect(headerStoreLinkLabel('https://brandthread.app/@nightshiftstudio')).toBe('@nightshiftstudio');
  });
  it('middle-truncates a long link with no @handle', () => {
    expect(headerStoreLinkLabel('https://shop.example.com/stores/abcdefghijklmnop').length).toBe(28);
  });
});
