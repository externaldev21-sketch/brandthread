/**
 * Profile cache invalidation.
 *
 * Profile screens keep their counts in local state, so a follow made on one
 * screen (the feed rail, a follower list, another profile) used to leave the
 * others showing stale numbers until a manual refresh. Every follow/unfollow
 * and every profile-content mutation publishes here; mounted profiles apply
 * the server-confirmed count immediately and refetch what they can't patch.
 *
 * Deliberately separate from socialService's `subscribeSocial`, which also
 * drives a full Thread feed reload — a follow tap must not reset the feed.
 */

export type ProfileEvent =
  | {
      type: 'follow';
      /** Canonical (Clerk) id of the account that was followed or unfollowed. */
      targetId: string;
      isFollowing: boolean;
      /** Server-confirmed follower count of the target, when the API returned one. */
      followersCount?: number;
      /** Canonical id of the viewer whose following count changed. */
      viewerId?: string | null;
    }
  | { type: 'content'; ownerId?: string | null };

type Listener = (event: ProfileEvent) => void;
const listeners = new Set<Listener>();

export function subscribeProfileEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitProfileEvent(event: ProfileEvent): void {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* one screen's handler must not break another's */ }
  }
}

/**
 * Following count after a follow toggle when only the previous count is known:
 * +1 on follow, -1 on unfollow, never below zero.
 */
export function nextFollowingCount(current: number, isFollowing: boolean): number {
  return Math.max(0, current + (isFollowing ? 1 : -1));
}
