import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-constants', () => ({ default: { expoConfig: { experiments: { baseUrl: '/fast-preview' } } } }));
import { stripWebBasePath, webAppPathname } from '@/lib/webAppPathname';

describe('static preview route prefix', () => {
  it('treats the mounted root as the root for preview redirects', () => {
    expect(webAppPathname('/fast-preview/')).toBe('/');
    expect(webAppPathname('/fast-preview')).toBe('/');
  });
  it('preserves the real deep-link destination without doubling the prefix', () => {
    expect(webAppPathname('/fast-preview/seller-inbox')).toBe('/seller-inbox');
    expect(webAppPathname('/fast-preview/(buyer)/feed')).toBe('/(buyer)/feed');
  });
  it('does not alter normal published/native paths or similar prefixes', () => {
    expect(stripWebBasePath('/seller-inbox')).toBe('/seller-inbox');
    expect(stripWebBasePath('/', '')).toBe('/');
    expect(stripWebBasePath('/fast-preview-other', '/fast-preview')).toBe('/fast-preview-other');
  });
});
