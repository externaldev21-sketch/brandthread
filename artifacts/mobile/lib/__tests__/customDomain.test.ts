import { describe, expect, it } from 'vitest';
import { normalizeCustomDomain } from '@/lib/customDomain';

describe('normalizeCustomDomain', () => {
  it('normalizes pasted URLs to a bare hostname', () => {
    expect(normalizeCustomDomain(' https://Shop.MyBrand.com/path?x=1 ')).toEqual({ ok: true, domain: 'shop.mybrand.com' });
    expect(normalizeCustomDomain('mybrand.co.uk.')).toEqual({ ok: true, domain: 'mybrand.co.uk' });
  });
  it('rejects things that are not domains', () => {
    for (const bad of ['', 'my brand', 'mybrand', 'my_brand.com', '-bad.com', 'bad-.com', 'x.c0m', 'emoji😀.com']) {
      expect(normalizeCustomDomain(bad).ok).toBe(false);
    }
  });
  it('rejects brandthread.app addresses', () => {
    expect(normalizeCustomDomain('mystore.brandthread.app').ok).toBe(false);
  });
});
