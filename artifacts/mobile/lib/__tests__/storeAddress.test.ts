import { describe, expect, it } from 'vitest';
import { storeHostFrom, storeSlugFrom, storeViewUrl } from '../storeAddress';

describe('store address', () => {
  it('never doubles the brandthread.app suffix (publish screen bug)', () => {
    // storeService stores the server slug as "<slug>.brandthread.app".
    expect(storeHostFrom('northline.brandthread.app')).toBe('northline.brandthread.app');
    expect(storeHostFrom('northline')).toBe('northline.brandthread.app');
    expect(storeHostFrom('https://Northline.brandthread.app/')).toBe('northline.brandthread.app');
  });

  it('does not invent a placeholder host when there is no slug', () => {
    expect(storeHostFrom('')).toBe('');
    expect(storeSlugFrom(undefined)).toBe('');
  });

  it('opens the store at a path that needs no DNS set up', () => {
    expect(storeViewUrl('northline.brandthread.app')).toBe('https://brandthread.app/s/northline');
    expect(storeViewUrl('')).toBeNull();
  });
});

import { storeAddressHost, storeAddressUrl } from '@/lib/storeAddress';

const bt = (subdomain?: string) => ({ id: 'd1', type: 'brandthread' as const, subdomain, verificationStatus: 'verified' as const, sslStatus: 'active' as const, isPrimary: true });

describe('store address', () => {
  it('prefers the Brandthread subdomain the Domains screen edits', () => {
    expect(storeAddressHost({ domains: [bt('atelier')], settings: { storeUrl: 'old.brandthread.app' } })).toBe('atelier.brandthread.app');
  });
  it('falls back to settings.storeUrl, slug or full host, without doubling the suffix', () => {
    expect(storeAddressHost({ domains: [], settings: { storeUrl: 'noire' } })).toBe('noire.brandthread.app');
    expect(storeAddressHost({ domains: [bt('')], settings: { storeUrl: 'noire.brandthread.app' } })).toBe('noire.brandthread.app');
  });
  it('uses a verified primary custom domain', () => {
    expect(storeAddressUrl({ domains: [bt('a'), { id: 'c', type: 'custom', customDomain: 'shop.noire.com', verificationStatus: 'verified', sslStatus: 'active', isPrimary: true }] })).toBe('https://shop.noire.com');
  });
  it('is null when no address is set (no placeholder)', () => {
    expect(storeAddressUrl({ domains: [], settings: { storeUrl: '' } })).toBeNull();
    expect(storeAddressUrl(null)).toBeNull();
  });
});
