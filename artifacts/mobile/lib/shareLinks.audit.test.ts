import { describe, expect, it } from 'vitest';
import { parseShareLink } from './shareLinks';
import { parseProfileDeepLink } from './shareProfile';

describe('look-alike hosts are not Brandthread links (audit)', () => {
  it('parseShareLink rejects hosts that only start with brandthread.app', () => {
    expect(parseShareLink('https://brandthread.app@evilshop/p/abc123def')).toBeNull();
    expect(parseShareLink('https://brandthread.app@novagoods')).toBeNull();
    expect(parseShareLink('https://brandthread.appx/u/jordan')).toBeNull();
    expect(parseShareLink('https://www.brandthread.app.evil.example/tag/ootd')).toBeNull();
  });

  it('still accepts the real origin with a path, query or nothing after it', () => {
    expect(parseShareLink('https://brandthread.app/@novagoods')?.href).toBe('/u/novagoods');
    expect(parseShareLink('https://www.brandthread.app/u/jordan')?.href).toBe('/u/jordan');
    expect(parseShareLink('https://brandthread.app')).toBeNull();
  });

  it('parseProfileDeepLink (QR scanner) rejects look-alike hosts', () => {
    expect(parseProfileDeepLink('https://brandthread.appu/jordan')).toBeNull();
    expect(parseProfileDeepLink('https://brandthread.app/u/Jordan')).toBe('jordan');
    expect(parseProfileDeepLink('brandthread://u/jordan')).toBe('jordan');
    expect(parseProfileDeepLink('brandthread:///u/jordan')).toBe('jordan');
  });
});
