/**
 * lib/previewFollowStore — preview-only follow state. The dev-build path
 * (follow request 401s → state kept here) is exercised live against the dev
 * bundle (scripts/store-screenshots/preview-data-verify.mjs); vitest compiles
 * with `__DEV__: false` (vitest.config.ts), i.e. a production build, which is
 * exactly where the store must stay inert.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPreviewFollowState,
  canUsePreviewFollow,
  getPreviewFollowing,
  isPreviewPersonId,
  resetPreviewFollowStore,
  setPreviewFollowing,
} from './previewFollowStore';

beforeEach(() => resetPreviewFollowStore());

describe('previewFollowStore', () => {
  it('only recognises seeded preview people', () => {
    expect(isPreviewPersonId('preview-seller-01')).toBe(true);
    expect(isPreviewPersonId('user_2abc')).toBe(false);
    expect(isPreviewPersonId(undefined)).toBe(false);
  });

  it('is inert in a production build — never fakes a follow, even for preview ids', () => {
    expect(canUsePreviewFollow('preview-seller-01')).toBe(false);
    expect(canUsePreviewFollow('user_2abc')).toBe(false);
  });

  it('remembers follow / unfollow for the session', () => {
    expect(getPreviewFollowing('preview-seller-01')).toBeUndefined();
    setPreviewFollowing('preview-seller-01', true);
    expect(getPreviewFollowing('preview-seller-01')).toBe(true);
    setPreviewFollowing('preview-seller-01', false);
    expect(getPreviewFollowing('preview-seller-01')).toBe(false);
  });

  it('applies the state to follow rows only, leaving untouched people as they were', () => {
    setPreviewFollowing('preview-seller-01', true);
    const rows = [
      { id: 'a', type: 'new_follower', actorId: 'preview-seller-01' },
      { id: 'b', type: 'new_follower', actorId: 'preview-seller-05' },
      { id: 'c', type: 'post_like', actorId: 'preview-seller-01' },
    ];
    const out = applyPreviewFollowState(rows);
    expect(out[0]).toEqual({ ...rows[0], isFollowingActor: true });
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });
});
