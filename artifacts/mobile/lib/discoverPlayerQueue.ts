/**
 * Discover → Threads feed handoff (TikTok's Discover tap-through).
 *
 * A Discover tile tap opens the real Threads feed anchored on that post
 * (app/discover-player.tsx?postId= → app/(tabs)/feed.tsx `anchorPostId`):
 * the tapped post first, then the feed's own For You content. The tile is
 * remembered here by id (setDiscoverAnchorPost) for posts with no real row.
 *
 * Profile grids' demo tiles still use the older queue mode: the grid's posts
 * can't ride along in a URL, so the tap parks them under a one-off token
 * (setDiscoverPlayerQueue) and the creatorFeed player reads them back.
 *
 * Each queued post is resolved to the real post (GET /api/posts/:id — real
 * media, video source, sound, product tags) so the player gets exactly what
 * the home feed would render. Posts with no real backing row (preview
 * fixtures, or a fetch that fails) fall back to the tile's own data so the
 * tapped post still opens instead of vanishing.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { mapApiPostToSellerThreadPost, type SellerThreadPost } from '@/services/socialService';
import type { DiscoverPost } from '@/lib/discoverFeed';

const queues = new Map<string, DiscoverPost[]>();
let nextToken = 0;
// A handful of recent taps is plenty — older entries are only kept so a
// back-then-forward re-render of the same player can still read its queue.
const MAX_QUEUES = 8;

/**
 * Parks the grid for the player: tapped post first, then the posts after it
 * in grid order, then the ones before it (so swiping never revisits the
 * tapped tile). Returns the token to pass as the route's `id`.
 */
export function setDiscoverPlayerQueue(posts: DiscoverPost[], startIndex: number): string {
  const start = Math.min(Math.max(0, startIndex), Math.max(0, posts.length - 1));
  const ordered = [...posts.slice(start), ...posts.slice(0, start)];
  const token = `d${Date.now().toString(36)}${(nextToken++).toString(36)}`;
  queues.set(token, ordered);
  while (queues.size > MAX_QUEUES) queues.delete(queues.keys().next().value as string);
  return token;
}

export function getDiscoverPlayerQueue(token: string): DiscoverPost[] {
  return queues.get(token) ?? [];
}

/** Discover tile ids carry a source prefix (lib/discoverFeed.ts) over the real post id. */
export function discoverPostApiId(id: string): string {
  return id.replace(/^(trend|friend)_/, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tile itself as a feed post — used only when no real post row resolves. */
export function discoverPostToThreadPost(post: DiscoverPost): SellerThreadPost {
  const now = post.createdAt;
  return {
    id: discoverPostApiId(post.id),
    authorId: post.authorId,
    authorAccountType: post.authorAccountType,
    authorName: post.authorName,
    authorHandle: post.authorHandle,
    authorInitials: post.authorInitials,
    authorColor: post.authorColor,
    sellerId: post.authorId,
    brandId: post.authorId,
    feedEligibility: 'thread_eligible',
    caption: post.caption ?? '',
    hashtags: [],
    mediaUris: post.imageUri ? [post.imageUri] : [],
    thumbnailUri: post.imageUri,
    aspectRatio: '9:16',
    // The tile only carries a poster frame, never a playable video URL.
    contentType: 'photo',
    postStatus: 'published',
    isDraft: false,
    isArchived: false,
    isDeleted: false,
    productTags: (post.productTags ?? []).map((t) => ({
      productId: t.productId,
      productName: t.productName,
      priceCents: t.priceCents,
    })),
    visibility: { allowComments: true, allowReposts: true, showLikeCount: true },
    scheduledAt: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    repostsCount: 0,
    savedCount: 0,
    sharesCount: 0,
    likedByMe: post.likedByMe === true,
    savedByMe: post.savedByMe === true,
    repostedByMe: false,
    friendReposts: [],
  };
}

async function resolveOne(post: DiscoverPost, idx: number): Promise<SellerThreadPost> {
  const apiId = discoverPostApiId(post.id);
  if (!UUID_RE.test(apiId)) return discoverPostToThreadPost(post);
  try {
    const raw = await serviceRequest<any>(`/api/posts/${encodeURIComponent(apiId)}`, { cache: 'no-store' });
    if (raw?.id !== apiId) return discoverPostToThreadPost(post);
    const mapped = mapApiPostToSellerThreadPost(raw, idx);
    if (!mapped.mediaUris.length) return discoverPostToThreadPost(post);
    // The single-post endpoint doesn't know the viewer; the tile already does.
    return {
      ...mapped,
      likedByMe: mapped.likedByMe || post.likedByMe === true,
      savedByMe: mapped.savedByMe || post.savedByMe === true,
    };
  } catch {
    return discoverPostToThreadPost(post);
  }
}

// Discover tiles opened in the real Threads feed (app/discover-player.tsx
// with `postId`), by tile id — so a post with no real backing row (preview
// fixtures, or a failed fetch) still opens from the tile's own data.
const anchorTiles = new Map<string, DiscoverPost>();

/** Remembers the tapped tile; returns the id to pass as the route's `postId`. */
export function setDiscoverAnchorPost(post: DiscoverPost): string {
  anchorTiles.delete(post.id);
  anchorTiles.set(post.id, post);
  while (anchorTiles.size > MAX_QUEUES) anchorTiles.delete(anchorTiles.keys().next().value as string);
  return post.id;
}

/**
 * The tapped Discover post as a feed post — the real post when it resolves,
 * else the remembered tile. Null when neither is known (e.g. a cold deep
 * link to a fixture id): the feed then just opens on its normal content.
 */
export async function loadDiscoverAnchorPost(postId: string): Promise<SellerThreadPost | null> {
  const tile = anchorTiles.get(postId);
  if (tile) return resolveOne(tile, 0);
  const apiId = discoverPostApiId(postId);
  if (!UUID_RE.test(apiId)) return null;
  try {
    const raw = await serviceRequest<any>(`/api/posts/${encodeURIComponent(apiId)}`, { cache: 'no-store' });
    return raw?.id === apiId ? mapApiPostToSellerThreadPost(raw, 0) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves one page of a parked queue to feed posts, in queue order (tapped
 * post first). Pages are small so the tapped post opens without waiting on
 * the whole grid; the player pages on as the buyer swipes.
 */
export async function loadDiscoverPlayerPage(
  token: string,
  offset: number,
  limit: number,
): Promise<{ posts: SellerThreadPost[]; hasMore: boolean; nextOffset: number }> {
  const queue = getDiscoverPlayerQueue(token);
  const slice = queue.slice(offset, offset + limit);
  const posts = await Promise.all(slice.map((post, i) => resolveOne(post, offset + i)));
  const nextOffset = offset + slice.length;
  return { posts, hasMore: nextOffset < queue.length, nextOffset };
}
