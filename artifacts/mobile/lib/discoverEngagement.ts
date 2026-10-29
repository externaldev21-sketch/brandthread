/**
 * Session memory of Like / Save taps made in the Discover post viewer
 * (components/discover/DiscoverPostViewer.tsx), keyed by post id.
 *
 * The viewer is a modal over the Discover grid, so its per-page state is
 * thrown away on close; the grid's post rows only carry the like/save state
 * from when they were fetched. Real posts are persisted through the social
 * APIs (POST /api/posts/:id/interact, /api/buyer/saved) — this store just
 * makes the viewer show what the viewer did (and the server accepted) when
 * the same post is reopened before the next refetch. Cleared on every
 * account switch / sign-out (lib/accountStorage.ts). Unit-tested.
 */
import { onAccountStorageScopeChange } from '@/lib/accountStorage';

export interface DiscoverEngagement {
  liked: boolean;
  likesCount: number;
  saved: boolean;
}

const overrides = new Map<string, DiscoverEngagement>();
// "What the viewer did" belongs to the account that did it: a switch or
// sign-out must not show the previous account's likes/saves.
onAccountStorageScopeChange(() => overrides.clear());

export function discoverEngagementFor(post: {
  id: string; likedByMe?: boolean; likesCount: number; savedByMe?: boolean;
}): DiscoverEngagement {
  return overrides.get(post.id) ?? { liked: !!post.likedByMe, likesCount: post.likesCount, saved: !!post.savedByMe };
}

export function rememberDiscoverEngagement(postId: string, engagement: DiscoverEngagement): void {
  overrides.set(postId, engagement);
}

export function toggledLike(e: DiscoverEngagement): DiscoverEngagement {
  return { ...e, liked: !e.liked, likesCount: Math.max(0, e.likesCount + (e.liked ? -1 : 1)) };
}

/**
 * The real post id behind a Discover row. lib/discoverFeed.ts prefixes ids
 * by source (`trend_<postId>`, `friend_<postId>`) so the two sources never
 * collide in the grid; the social APIs need the bare post id.
 */
export function discoverPostApiId(discoverId: string): string {
  return discoverId.replace(/^(trend|friend)_/, '');
}

/** Test-only reset. */
export function resetDiscoverEngagement(): void {
  overrides.clear();
}
