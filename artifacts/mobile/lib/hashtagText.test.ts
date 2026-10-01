import { describe, expect, it } from 'vitest';
import { hashtagHref, hasHashtags, normalizeTag, splitCaption } from './hashtagText';

describe('splitCaption', () => {
  it('returns one plain segment when there are no hashtags', () => {
    expect(splitCaption('Midnight tailoring')).toEqual([{ kind: 'text', text: 'Midnight tailoring' }]);
    expect(splitCaption('')).toEqual([]);
  });

  it('splits tags out and keeps surrounding text byte-for-byte', () => {
    const segments = splitCaption('New drop #Vintage, and #y2k_fits!');
    expect(segments.map((s) => s.text).join('')).toBe('New drop #Vintage, and #y2k_fits!');
    expect(segments.filter((s) => s.kind === 'tag')).toEqual([
      { kind: 'tag', text: '#Vintage', tag: 'vintage' },
      { kind: 'tag', text: '#y2k_fits', tag: 'y2k_fits' },
    ]);
  });

  it('handles a tag at the very start and unicode tags', () => {
    expect(splitCaption('#東京 street')[0]).toEqual({ kind: 'tag', text: '#東京', tag: '東京' });
  });

  it('ignores ordinals, url anchors and mid-word hashes', () => {
    expect(hasHashtags('#1 seller, item #2')).toBe(false);
    expect(hasHashtags('https://x.test/page#section')).toBe(false);
    expect(hasHashtags('abc#def')).toBe(false);
  });
});

describe('normalizeTag / hashtagHref', () => {
  it('lowercases, NFKC-normalises and caps at 30 characters', () => {
    expect(normalizeTag('#OOTD')).toBe('ootd');
    expect(normalizeTag('a'.repeat(40))).toHaveLength(30);
  });
  it('builds the route', () => {
    expect(hashtagHref('ootd')).toBe('/hashtag/ootd');
    expect(hashtagHref('東京')).toBe('/hashtag/%E6%9D%B1%E4%BA%AC');
  });
});
