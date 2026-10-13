import { describe, expect, it } from 'vitest';
import { mutualFollowersSegments } from '../mutualFollowersText';

const text = (users: Array<{ username?: string | null; displayName?: string | null }>, count: number) =>
  mutualFollowersSegments(users, count).map((s) => s.text).join('');

describe('mutualFollowersSegments', () => {
  it('uses Instagram wording', () => {
    expect(text([{ username: 'maya' }], 1)).toBe('Followed by maya');
    expect(text([{ username: 'maya' }, { username: 'leo' }], 2)).toBe('Followed by maya and leo');
    expect(text([{ username: 'maya' }, { username: 'leo' }, { username: 'ana' }], 3)).toBe('Followed by maya, leo and 1 other');
    expect(text([{ username: 'maya' }, { username: 'leo' }, { username: 'ana' }], 7)).toBe('Followed by maya, leo and 5 others');
    expect(text([{ username: 'maya' }], 4)).toBe('Followed by maya and 3 others');
  });

  it('bolds only the names and falls back to display name', () => {
    const segments = mutualFollowersSegments([{ username: null, displayName: 'Maya Lane' }, { username: 'leo' }], 2);
    expect(segments.filter((s) => s.bold).map((s) => s.text)).toEqual(['Maya Lane', 'leo']);
  });

  it('is empty when there is nobody to show', () => {
    expect(mutualFollowersSegments([], 0)).toEqual([]);
    expect(mutualFollowersSegments([], 3)).toEqual([]);
  });
});
