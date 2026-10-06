/**
 * Followers / Following counts for the buyer profile header in the dev-web
 * preview's `demo=1` dataset. The preview has no backend, so the profile's
 * live-count fetch (api.social.profile) is skipped and the header fell back
 * to the local profile's 0 / 0 — while the same demo session's Activity shows
 * four people following you (previewActivity.ts) and the Friends screen
 * lists the people you follow (previewFriends.ts). Counting from those same
 * seeds keeps the demo consistent. Returns null outside demo mode, so a
 * fresh preview and every real account are untouched.
 */
import { isPreviewDemoMode } from './devPreview';
import { PREVIEW_FOLLOWING } from './previewFriends';
import { getPreviewFollowing } from './previewFollowStore';

type FollowItem = { type: string; actorId?: string; cta?: string; isFollowingActor?: boolean };

/** Pure: followers = everyone with a "followed you" row; following = the
 *  seeded following list, plus followers you already follow (no "Follow back"
 *  prompt, or followed back this session), minus anyone unfollowed. */
export function computePreviewSocialCounts(
  items: readonly FollowItem[],
  followingIds: readonly string[],
  sessionFollowState: (userId: string) => boolean | undefined,
): { followers: number; following: number } {
  const followers = new Set<string>();
  const following = new Set<string>(followingIds);
  for (const item of items) {
    if (item.type !== 'new_follower' || !item.actorId) continue;
    followers.add(item.actorId);
    if (item.isFollowingActor || (item.isFollowingActor === undefined && item.cta !== 'Follow back')) {
      following.add(item.actorId);
    }
  }
  for (const id of [...followers, ...followingIds]) {
    const state = sessionFollowState(id);
    if (state === true) following.add(id);
    if (state === false) following.delete(id);
  }
  return { followers: followers.size, following: following.size };
}

export async function getPreviewSocialCounts(): Promise<{ followers: number; following: number } | null> {
  if (!isPreviewDemoMode()) return null;
  // Loaded lazily: previewActivity.ts pulls in the preview's image assets,
  // which only demo mode ever needs.
  const { getPreviewActivity } = await import('./previewActivity');
  return computePreviewSocialCounts(
    getPreviewActivity(),
    PREVIEW_FOLLOWING.map((p) => p.userId),
    getPreviewFollowing,
  );
}
