import { describe, expect, it } from 'vitest';
import { normalizeStoryLinkUrl, storyLinkDisplay } from './storyLinkSticker';

describe('normalizeStoryLinkUrl', () => {
  it('keeps a full http(s) URL', () => {
    expect(normalizeStoryLinkUrl('https://example.com/shop?x=1#y')).toBe('https://example.com/shop?x=1#y');
    expect(normalizeStoryLinkUrl('http://shop.example.co.uk')).toBe('http://shop.example.co.uk');
    expect(normalizeStoryLinkUrl('HTTPS://Example.com')).toBe('https://Example.com');
  });

  it('adds https:// when the scheme is missing', () => {
    expect(normalizeStoryLinkUrl('example.com/shop')).toBe('https://example.com/shop');
    expect(normalizeStoryLinkUrl('  www.example.com  ')).toBe('https://www.example.com');
    expect(normalizeStoryLinkUrl('example.com:8080/x')).toBe('https://example.com:8080/x');
  });

  it('rejects anything that is not a plain web address', () => {
    for (const bad of ['', '   ', 'https://', 'not a url', 'example', 'localhost:3000', 'ftp://example.com',
      'javascript:alert(1)', 'mailto:me@example.com', 'https://exa mple.com', 'https://.com']) {
      expect(normalizeStoryLinkUrl(bad)).toBeNull();
    }
  });
});

describe('storyLinkDisplay', () => {
  it('drops the scheme and a trailing slash', () => {
    expect(storyLinkDisplay('https://example.com/')).toBe('example.com');
    expect(storyLinkDisplay('http://example.com/shop')).toBe('example.com/shop');
  });
});
