import { describe, expect, it } from 'vitest';
import {
  PROFILE_AVATAR_SIZE, activeStoryIds, avatarGeometry, centreOffset, contentBox,
} from '@/components/profile/profileAvatarGeometry';
import { PROFILE_GRID_GAP, TILE_ASPECT_4_5, computeProfileLayout } from '@/components/profile/profileGeometry';

describe('own-profile avatar geometry', () => {
  it('is 72pt on every phone width', () => {
    expect(PROFILE_AVATAR_SIZE).toBe(72);
  });

  it('sizes every ring so its content box is exactly the next circle (concentric by construction)', () => {
    const g = avatarGeometry();
    expect(g).toMatchObject({ avatar: 72, halo: 80, outer: 84 });
    expect(contentBox(g.halo, g.haloBorder, g.haloPadding)).toBe(g.avatar);
    expect(contentBox(g.outer, g.storyRing)).toBe(g.halo);
    expect(centreOffset(g.halo, g.haloBorder, g.haloPadding, g.avatar)).toBe(0);
    expect(centreOffset(g.outer, g.storyRing, 0, g.halo)).toBe(0);
  });

  it('documents the old bug: an 88pt avatar in a 94pt ring with 3pt border + 3pt padding sat 3pt off-centre', () => {
    expect(contentBox(88 + 6, 3, 3)).toBe(82);
    expect(centreOffset(88 + 6, 3, 3, 88)).toBe(3);
  });

  it('keeps only unexpired stories (numeric or ISO expiry)', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(activeStoryIds([
      { id: 'a', expiresAt: now + 1 },
      { id: 'b', expiresAt: now - 1 },
      { id: 'c', expiresAt: '2026-09-29T00:00:00Z' },
      { id: 'd', expiresAt: '2026-09-27T00:00:00Z' },
      { id: 'e' },
      null,
    ], now)).toEqual(['a', 'c']);
    expect(activeStoryIds(undefined, now)).toEqual([]);
  });
});

describe('profile grid tiles', () => {
  it('stays 9:16 by default and is 4:5 (3 columns, 1pt gutters) for own profiles', () => {
    for (const width of [375, 390, 430]) {
      const video = computeProfileLayout(width, 844, 'ios');
      expect(video.tileHeight).toBe(Math.round((video.tileWidth * 16) / 9));
      const own = computeProfileLayout(width, 844, 'ios', { tileAspect: TILE_ASPECT_4_5 });
      expect(own.gridColumns).toBe(3);
      expect(own.tileWidth).toBe(Math.floor((width - 2 * PROFILE_GRID_GAP) / 3));
      expect(own.tileHeight).toBe(Math.round(own.tileWidth * 1.25));
    }
  });
});
