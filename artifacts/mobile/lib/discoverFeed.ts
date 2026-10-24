/**
 * Discover — For You / Fits grid data, plus the Brands / People / Drops lists.
 *
 * The grid reads ONE server endpoint, GET /api/public/discover (see
 * fetchDiscoverPage): cursor-paged, ranked posts first then recent public
 * posts from everyone, every item with an image. It replaced composing the
 * grid client-side from /api/public/trending (no image field → empty dark
 * tiles; limit > 50 → 400 on the second page → grid replaced by the empty
 * state) plus friend activity.
 *
 * Blocked/muted authors are always dropped. Cold start in preview mode only
 * (?bt_preview=buyer / demo): a thin first page is backfilled with
 * lib/previewDiscover.ts fixtures. Never active outside the dev/preview gate.
 */
import { getBlockedUsers, getMutedUsers } from '@/services/socialService';
import { parseAspectRatio } from '@/lib/discoverMasonry';
import { bannerStill, resolveProfileBanner } from '@/components/profile/profileBannerRules';
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
  aspectRatio?: number;
  durationSec?: number;
  caption?: string;
  likesCount: number;
  /** The author turned like counts off — show views (or nothing) instead. */
  likesHidden?: boolean;
  viewsCount?: number;
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
  isFollowing?: boolean;
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

/** Maps one item of `api.publicDiscover.page()` into a Discover tile. */
export function mapDiscoverItemToPost(row: any): DiscoverPost | null {
  if (!row?.id || !row?.author?.userId || !row?.imageUrl) return null;
  const author = row.author;
  const name = author.name || 'Brandthread member';
  return {
    id: String(row.id),
    authorId: author.userId,
    authorName: name,
    authorHandle: author.handle || `@${String(name).toLowerCase().replace(/\s+/g, '')}`,
    authorInitials: initialsOf(name),
    authorColor: colorFor(author.userId),
    authorAvatarUrl: author.avatarUrl ?? undefined,
    authorAccountType: author.accountType === 'buyer' ? 'buyer' : 'seller',
    media: row.mediaType === 'video' ? 'video' : row.mediaType === 'slideshow' ? 'slideshow' : 'photo',
    imageUri: row.imageUrl,
    aspectRatio: parseAspectRatio(row.aspectRatio) ?? undefined,
    durationSec: Number(row.durationSec ?? row.duration) > 0 ? Number(row.durationSec ?? row.duration) : undefined,
    caption: row.caption ?? undefined,
    likesCount: typeof row.likesCount === 'number' ? row.likesCount : 0,
    likesHidden: row.likesCount === null,
    viewsCount: typeof row.viewsCount === 'number' ? row.viewsCount : 0,
    commentsCount: row.commentsCount ?? 0,
    createdAt: row.createdAt ?? new Date().toISOString(),
  };
}

export interface ComposeDiscoverFeedOptions {
  api: any;
  isSignedIn: boolean;
  filter: 'forYou' | 'fits';
  limit?: number;
  /** Throw when every source it tried failed and nothing (not even preview
   *  backfill) filled the grid, so the caller can show an error + retry
   *  instead of the "Nothing to show yet" empty state. */
  throwWhenUnreachable?: boolean;
}

export interface DiscoverPage {
  posts: DiscoverPost[];
  /** null only when the server says this was the last page. */
  nextCursor: string | null;
}

/**
 * One page of the For You / Fits grid from GET /api/public/discover.
 *
 * The server owns ordering (ranked first, then recent public posts) and
 * guarantees every item has an image, so pages are appended as-is — no
 * client re-sort, which used to reshuffle tiles already on screen. Throws on
 * a network/server error so the caller can keep what it already shows and
 * offer a retry, instead of treating a failure as "no posts".
 *
 * Preview mode (?bt_preview / demo only) backfills a thin FIRST page with
 * lib/previewDiscover.ts fixtures; never active outside the dev/preview gate.
 */
export async function fetchDiscoverPage({
  api, isSignedIn, filter, limit = 24, cursor = null,
}: ComposeDiscoverFeedOptions & { cursor?: string | null }): Promise<DiscoverPage> {
  const [blocked, muted, response] = await Promise.all([
    getBlockedUsers().catch(() => []),
    getMutedUsers().catch(() => []),
    api.publicDiscover.page({ cursor, limit, kind: filter }),
  ]);
  const hiddenIds = new Set<string>([
    ...blocked.map((b) => b.blockedUserId),
    ...muted.map((m) => m.mutedUserId),
  ]);
  let posts: DiscoverPost[] = (Array.isArray(response?.items) ? response.items : [])
    .map(mapDiscoverItemToPost)
    .filter((p: DiscoverPost | null): p is DiscoverPost => !!p && !hiddenIds.has(p.authorId));

  if (!isSignedIn) {
    // Guests keep their list on this device; signed-in accounts are filtered
    // server-side. An unreadable local list must not blank the whole grid.
    const phrases = (await readGuestMutedWords().catch(() => [])).map((word) => word.phrase);
    posts = posts.filter((post) => !matchesGuestMutedWords(post.caption, phrases));
  }

  const nextCursor = typeof response?.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null;
  if (!cursor && posts.length < 12 && isPreviewCatalogEnabled()) {
    const existingIds = new Set(posts.map((p) => p.id));
    posts.push(...getPreviewDiscoverPosts(filter).filter((p) => !existingIds.has(p.id)));
  }
  return { posts, nextCursor };
}

/** First page only — for callers that show a fixed slice (Search's suggestions, the app-start warmer). */
export async function composeDiscoverPosts(opts: ComposeDiscoverFeedOptions): Promise<DiscoverPost[]> {
  return (await fetchDiscoverPage(opts)).posts;
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
            imageUri: bannerStill(resolveProfileBanner(data.profile as any)) ?? (data.products ?? [])[0]?.images?.[0],
            followersLabel: 'Following',
            isFollowing: true,
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
    // /api/public/drops returns `heroImageUrl` + a `seller` {brandName,
    // displayName} join; the flat fields are accepted too. A row still
    // missing its brand or image is dropped rather than rendered with a
    // placeholder ("Brand", blank thumbnail).
    drops = (Array.isArray(rows) ? rows : []).map((r: any) => ({
      id: r.id,
      name: r.name ?? r.title ?? 'Drop',
      brandName: r.brandName ?? r.sellerDisplayName ?? r.seller?.brandName ?? r.seller?.displayName ?? '',
      imageUri: r.imageUri ?? r.heroImageUrl ?? (r.images ?? [])[0],
      releaseAt: r.releaseAt ?? null,
      live: !!r.live,
    })).filter((d: DiscoverDrop) => !!d.brandName?.trim() && !!d.imageUri);
  } catch (error) {
    if (!isPreviewCatalogEnabled()) throw error;
    // Preview backfill below.
  }
  if (drops.length === 0 && isPreviewCatalogEnabled()) drops = getPreviewDrops();
  return drops;
}
