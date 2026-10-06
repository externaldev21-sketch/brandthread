import { beforeEach, describe, expect, it, vi } from 'vitest';

const { demoMode, activity } = vi.hoisted(() => ({
  demoMode: { value: true },
  activity: { items: [] as Array<Record<string, unknown>> },
}));

// previewActivity.ts pulls in image assets vitest can't load — stand in the
// same new_follower rows its demo seed has (Atelier Noire + Saint Rue with a
// "Follow back" prompt, Kuro Line "followed you back", Orison already followed).
vi.mock('../previewActivity', () => ({ getPreviewActivity: () => activity.items }));
vi.mock('../devPreview', () => ({ isPreviewDemoMode: () => demoMode.value }));

import { computePreviewSocialCounts, getPreviewSocialCounts } from '../previewSocialCounts';
import { PREVIEW_FOLLOWING } from '../previewFriends';
import { resetPreviewFollowStore, setPreviewFollowing } from '../previewFollowStore';

const SEED = [
  { type: 'new_follower', actorId: 'preview-seller-01', cta: 'Follow back' },
  { type: 'post_like', actorId: 'preview-seller-02' },
  { type: 'new_follower', actorId: 'preview-seller-03', cta: 'Follow back' },
  { type: 'new_follower', actorId: 'preview-seller-05' },
  { type: 'new_follower', actorId: 'preview-seller-04', cta: undefined },
];

describe('computePreviewSocialCounts', () => {
  it('counts every distinct follower and the people already followed', () => {
    expect(computePreviewSocialCounts(SEED, ['f1', 'f2'], () => undefined))
      .toEqual({ followers: 4, following: 4 });
  });
  it('applies this session’s follow-back / unfollow state', () => {
    const state = (id: string) => (id === 'preview-seller-01' ? true : id === 'f1' ? false : undefined);
    expect(computePreviewSocialCounts(SEED, ['f1', 'f2'], state)).toEqual({ followers: 4, following: 4 });
  });
  it('is 0/0 with no follow rows', () => {
    expect(computePreviewSocialCounts([], [], () => undefined)).toEqual({ followers: 0, following: 0 });
  });
});

describe('getPreviewSocialCounts', () => {
  beforeEach(() => { resetPreviewFollowStore(); activity.items = SEED; demoMode.value = true; });

  it('demo=1: never 0 Followers while Activity shows people following you', async () => {
    const counts = await getPreviewSocialCounts();
    expect(counts).toEqual({ followers: 4, following: 2 + PREVIEW_FOLLOWING.length });
  });

  it('follow back from Activity moves the Following count', async () => {
    setPreviewFollowing('preview-seller-01', true);
    expect((await getPreviewSocialCounts())?.following).toBe(3 + PREVIEW_FOLLOWING.length);
  });

  it('outside demo mode returns null (no fake counts)', async () => {
    demoMode.value = false;
    expect(await getPreviewSocialCounts()).toBeNull();
  });
});

describe('previewActivity.ts demo seed text (QA-0039)', () => {
  it('never renders a placeholder "@you" handle (shared by buyer + seller Activity, so no viewer handle can be hardcoded)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../previewActivity.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/@you\b/);
  });
});
