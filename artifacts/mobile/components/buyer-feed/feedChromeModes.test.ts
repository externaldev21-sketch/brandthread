import { describe, expect, it } from 'vitest';
import { shouldSpinDisc } from './SoundDisc';
import { buildTrendingCreators } from './FollowingTrendingCreators';
import { clearModeChromeStyle, PHOTO_AUTO_ADVANCE_DEFAULT } from './clearMode';

describe('feed chrome modes', () => {
  it('disc spins only when active and motion allowed', () => {
    expect(shouldSpinDisc(true)).toBe(true);
    expect(shouldSpinDisc(true, true)).toBe(false);
    expect(shouldSpinDisc(false)).toBe(false);
  });
  it('clear mode hides and disables chrome', () => {
    expect(clearModeChromeStyle(false)).toEqual({ opacity: 1 });
    expect(clearModeChromeStyle(true)).toEqual({ opacity: 0, pointerEvents: 'none' });
  });
  it('photo auto-advance defaults off', () => { expect(PHOTO_AUTO_ADVANCE_DEFAULT).toBe(false); });
  it('trending creators: real posts grouped by seller, official first, no fakes', () => {
    const post = (id: string, sellerId: string, extra = {}) => ({ id, sellerId, authorName: 'N'+sellerId, authorHandle: '@h', postStatus: 'published', contentType: 'video', mediaUris: [], thumbnailUri: 'p.jpg', visibility: { isPublic: true }, ...extra });
    expect(buildTrendingCreators(undefined, undefined)).toEqual([]);
    const r = buildTrendingCreators([post('1','a'), post('2','a'), post('3','off',{ isOfficial: true }), post('4','x',{ sponsored: true }), post('5','me')],
      [{ id: 'b', sellerId: 'a', name: 'dup' }, { id: 'c', sellerId: 'z', name: 'Brand' }, { id: 'd', sellerId: '', name: 'bad' }], 'me');
    expect(r.map(c => c.sellerId)).toEqual(['off', 'a', 'z']);
    expect(r[1].posterUri).toBe('p.jpg');
  });
});
