import { describe, expect, it } from 'vitest';
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
