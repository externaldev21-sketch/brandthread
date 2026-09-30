/**
 * Discover — For You feed composition (PR A: "Discover grid + viewer +
 * filters + people row").
 *
 * v1 explainable ranking, composed client-side from existing endpoints —
 * no new backend yet (that's PR B — a dedicated ranking endpoint; buyers
 * never tag products, so "Shop the look" only ever appears on posts that
 * carry a seller product tag):
 *   - brand/seller posts come from the existing public Trending feed
 *     (already cross-user, already real) — `api.publicTrending.get(limit)`.
 *   - buyer posts come from the signed-in buyer's friend activity feed
 *     (the only cross-user buyer-post source that exists today; open
 *     buyer-post discovery across everyone needs the PR B ranking
 *     endpoint) — `api.social.friendActivity(limit, offset)`.
 *   - the mix favors accounts the buyer follows and recent engagement
 *     (organicScore/finalScore already reflect recency+engagement on the
 *     trending payload); blocked/muted authors are always dropped.
 *   - cold start: when real results are thin, preview mode backfills with
 *     lib/previewDiscover.ts fixtures so the grid never looks empty in
 *     ?bt_preview=buyer. Never active outside the dev/preview gate.
 */
import { getBlockedUsers, getMutedUsers } from '@/services/socialService';
import { isPreviewCatalogEnabled } from '@/lib/previewCatalog';
import { matchesGuestMutedWords, readGuestMutedWords } from '@/lib/guestMutedWords';
import { getPreviewDiscoverPosts, getPreviewBrandCards, getPreviewDiscoverPeople, getPreviewDrops } from '@/lib/previewDiscover';

export type DiscoverPostMedia = 'photo' | 'video' | 'slideshow';

export interface DiscoverProductTag {
  productId: string;
  productName: string;
  priceCents: number;
  tagId?: string;
}

export interface DiscoverPost {
  id: string;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  authorColor: string;
  authorAvatarUrl?: string;
  authorAccountType: 'buyer' | 'seller';
  authorVerified?: boolean;
  media: DiscoverPostMedia;
  imageUri?: string;
  caption?: string;
  likesCount: number;
  commentsCount: number;
  likedByMe?: boolean;
  savedByMe?: boolean;
  productTags?: DiscoverProductTag[];
  createdAt: string;
}

export interface DiscoverBrandCard {
  id: string;
  name: string;
  verified: boolean;
  imageUri?: string;
  followersLabel?: string;
}

export interface DiscoverPersonSuggestion {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  color: string;
  avatarUrl?: string;
  reason: string;
  isFollowing: boolean;
}

export interface DiscoverDrop {
  id: string;
  name: string;
  brandName: string;
  imageUri?: string;
  releaseAt?: string | null;
  live: boolean;
}

function initialsOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

// Monochrome only (Discover stays on-brand) — a few dark-gray shades so
// avatar-initial fallbacks are still distinguishable from each other without
// ever reading as a colored brand identity.
const AVATAR_SHADES = ['#2A2A2E', '#3A3A3F', '#242428', '#333338'];
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_SHADES[hash % AVATAR_SHADES.length];
}

/** Maps one row of `api.publicTrending.get()` into a brand/seller Discover tile. */
function mapTrendingToPost(row: any): DiscoverPost | null {
  if (!row?.id || !row?.brandId) return null;
  return {
    id: `trend_${row.id}`,
    authorId: row.brandId,
    authorName: row.brand ?? 'Brand',
    authorHandle: `@${String(row.brand ?? 'brand').toLowerCase().replace(/\s+/g, '')}`,
    authorInitials: initialsOf(row.brand ?? 'B'),
    authorColor: colorFor(row.brandId),
    authorAccountType: 'seller',
    authorVerified: !!row.verified,
    media: row.mediaType === 'video' ? 'video' : 'photo',
    imageUri: row.imageUri ?? undefined,
    caption: row.caption ?? undefined,
    likesCount: row.likesCount ?? 0,
    commentsCount: row.commentsCount ?? 0,
    // The current public Trending payload never sends this — forward
    // compatible passthrough for once a seller-tagged trending post exists,
    // so "Shop the look" only ever appears where a real tag is present.
    productTags: Array.isArray(row.productTags) ? row.productTags : undefined,
    createdAt: new Date().toISOString(),
  };
}

/** Maps one row of `api.social.friendActivity()` into a buyer Discover tile. */
function mapFriendPostToPost(row: any): DiscoverPost | null {
  if (!row?.id || !row?.authorId) return null;
  return {
    id: `friend_${row.id}`,
    authorId: row.authorId,
    authorName: row.authorName ?? 'Buyer',
    authorHandle: row.authorHandle ?? `@${String(row.authorName ?? 'buyer').toLowerCase().replace(/\s+/g, '')}`,
    authorInitials: row.authorInitials ?? initialsOf(row.authorName ?? 'B'),
    authorColor: row.authorColor ?? colorFor(row.authorId),
    authorAccountType: 'buyer',
    media: row.type === 'video' ? 'video' : row.type === 'slideshow' ? 'slideshow' : 'photo',
    imageUri: row.mediaUrl ?? undefined,
    caption: row.caption ?? undefined,
    likesCount: row.likesCount ?? 0,
    commentsCount: row.commentsCount ?? 0,
    likedByMe: !!row.likedByMe,
    savedByMe: !!row.savedByMe,
    createdAt: row.createdAt ?? new Date().toISOString(),
  };
}

export interface ComposeDiscoverFeedOptions {
  api: any;
  isSignedIn: boolean;
  filter: 'forYou' | 'fits';
  limit?: number;
}

/** One page of the For You / Fits grid, real data first, preview-backfilled on cold start. */
export async function composeDiscoverPosts({ api, isSignedIn, filter, limit = 30 }: ComposeDiscoverFeedOptions): Promise<DiscoverPost[]> {
  const [blocked, muted] = await Promise.all([
    getBlockedUsers().catch(() => []),
    getMutedUsers().catch(() => []),
  ]);
  const hiddenIds = new Set<string>([
    ...blocked.map((b) => b.blockedUserId),
    ...muted.map((m) => m.mutedUserId),
  ]);

  let posts: DiscoverPost[] = [];

  if (filter !== 'fits') {
    try {
      const { trending } = await api.publicTrending.get(limit);
      posts.push(...(Array.isArray(trending) ? trending : []).map(mapTrendingToPost).filter((p: DiscoverPost | null): p is DiscoverPost => !!p));
    } catch {
      // Keep going — friend posts (and preview backfill) can still fill the grid.
    }
  }

  if (isSignedIn) {
    try {
      const rows = await api.social.friendActivity(20, 0);
      posts.push(...(Array.isArray(rows) ? rows : []).map(mapFriendPostToPost).filter((p: DiscoverPost | null): p is DiscoverPost => !!p));
    } catch {
      // No friends yet, or offline — fine, the rest of the mix still shows.
    }
  }

  posts = posts.filter((p) => !hiddenIds.has(p.authorId));

  if (posts.length < 12 && isPreviewCatalogEnabled()) {
    const seeded = getPreviewDiscoverPosts(filter);
    const existingIds = new Set(posts.map((p) => p.id));
    posts.push(...seeded.filter((p) => !existingIds.has(p.id)));
  }

  if (filter === 'fits') posts = posts.filter((p) => p.authorAccountType === 'buyer');
  if (!isSignedIn) {
    // Guests keep their list on this device; signed-in accounts are filtered
    // server-side. An unreadable local list must not blank the whole grid.
    const phrases = (await readGuestMutedWords().catch(() => [])).map((word) => word.phrase);
    posts = posts.filter((post) => !matchesGuestMutedWords(post.caption, phrases));
  }

  // Recency + engagement, interleaved so one account never dominates a run
  // of consecutive tiles (a simple, explainable v1 — no personalization
  // model yet; that's the PR B ranking endpoint).
  posts.sort((a, b) => (b.likesCount + b.commentsCount * 2) - (a.likesCount + a.commentsCount * 2));
  return posts;
}

export async function composeDiscoverBrands({ api, isSignedIn }: { api: any; isSignedIn: boolean }): Promise<DiscoverBrandCard[]> {
  const cards = new Map<string, DiscoverBrandCard>();

  // Brands the buyer already follows surface first — reusing the same
  // composition the old "From Brands You Follow" rail used (no dedicated
  // endpoint exists yet: api.social.following() then api.publicSellers.get()
  // per seller).
  if (isSignedIn) {
    try {
      const following = await api.social.following();
      const sellers = (Array.isArray(following) ? following : []).slice(0, 8);
      await Promise.all(sellers.map(async (f: any) => {
        try {
          const data = await api.publicSellers.get(f.userId);
          if (!data?.profile) return;
          cards.set(f.userId, {
            id: f.userId,
            name: data.profile.displayName ?? data.profile.brandName ?? f.name ?? 'Brand',
            verified: !!data.profile.verified,
            imageUri: (data.products ?? [])[0]?.images?.[0],
            followersLabel: 'Following',
          });
        } catch {
          // One follow failing to resolve shouldn't drop the rest.
        }
      }));
    } catch {
      // Not signed in / offline — trending-derived brands below still fill the grid.
    }
  }

  // Followed sellers and trending posts can key the same real-world brand by
  // different ids (no shared brand directory exists yet) — dedupe by name
  // too so "Ember & Ash" never shows up twice.
  const namesSeen = new Set(Array.from(cards.values()).map((c) => c.name.toLowerCase()));

  try {
    const { trending } = await api.publicTrending.get(40);
    for (const row of Array.isArray(trending) ? trending : []) {
      const name = (row?.brand ?? '').toLowerCase();
      if (!row?.brandId || cards.has(row.brandId) || namesSeen.has(name)) continue;
      cards.set(row.brandId, {
        id: row.brandId,
        name: row.brand ?? 'Brand',
        verified: !!row.verified,
        imageUri: row.imageUri ?? undefined,
      });
      namesSeen.add(name);
    }
  } catch {
    // Preview backfill below.
  }
  if (cards.size < 6 && isPreviewCatalogEnabled()) {
    for (const brand of getPreviewBrandCards()) if (!cards.has(brand.id) && !namesSeen.has(brand.name.toLowerCase())) cards.set(brand.id, brand);
  }
  return Array.from(cards.values());
}

export async function composeDiscoverPeople({ getFriendSuggestions }: { getFriendSuggestions: () => Promise<any[]> }): Promise<DiscoverPersonSuggestion[]> {
  let people: DiscoverPersonSuggestion[] = [];
  try {
    const rows = await getFriendSuggestions();
    people = (Array.isArray(rows) ? rows : []).map((r: any) => ({
      userId: r.userId,
      name: r.name,
      handle: r.handle ?? `@${String(r.name ?? '').toLowerCase().replace(/\s+/g, '')}`,
      initials: r.initials ?? initialsOf(r.name ?? '?'),
      color: r.color ?? colorFor(r.userId ?? r.name ?? ''),
      avatarUrl: r.avatarUrl,
      reason: r.reason ?? 'Suggested for you',
      isFollowing: !!r.isFollowing,
    }));
  } catch {
    // Preview backfill below.
  }
  if (people.length === 0 && isPreviewCatalogEnabled()) people = getPreviewDiscoverPeople();
  return people;
}

export async function composeDiscoverDrops({ api }: { api: any }): Promise<DiscoverDrop[]> {
  let drops: DiscoverDrop[] = [];
  try {
    const rows = await api.publicDrops.list('upcoming');
    drops = (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r.id,
      name: r.name ?? r.title ?? 'Drop',
      brandName: r.brandName ?? r.sellerDisplayName ?? 'Brand',
      imageUri: r.imageUri ?? (r.images ?? [])[0],
      releaseAt: r.releaseAt ?? null,
      live: !!r.live,
    }));
  } catch {
    // Preview backfill below.
  }
  if (drops.length === 0 && isPreviewCatalogEnabled()) drops = getPreviewDrops();
  return drops;
}
