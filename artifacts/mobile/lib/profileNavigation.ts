/**
 * Profile navigation targets — the single source for every link into and out
 * of a profile, so the feed → profile → videos → product → checkout loop uses
 * the same route names and param spellings everywhere.
 *
 * Pure functions (no expo-router import) so tests can assert the exact hrefs.
 */

export type ProfileAccountType = 'buyer' | 'seller';

/**
 * Where the buyer navigated FROM, attached as `?src=` to a store/product
 * href so the destination screen's mount effect can record a real
 * `store_visits` row with an honest source instead of guessing. Matches the
 * four categories the seller Dashboard's Traffic sources panel shows.
 * Omitted (undefined) at a call site that isn't one of these three surfaces
 * — the recording screen then falls back to 'external', which is also the
 * correct answer for a cold deep link / share link open.
 */
export type StoreVisitSource = 'feed' | 'search' | 'profile';

/**
 * Turns whatever `?src=` a route param came in as into one of the four real
 * categories the store-visits endpoint accepts, defaulting to 'external' —
 * the honest answer for a cold deep link, a shared link, or any in-app
 * navigation that wasn't tagged above.
 */
export function resolveStoreVisitSource(src: unknown): 'feed' | 'search' | 'profile' | 'external' {
  return src === 'feed' || src === 'search' || src === 'profile' ? src : 'external';
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/**
 * Another person's profile. Sellers open the brand profile (`id`), buyers the
 * buyer profile (`userId` — the param that screen actually reads).
 */
export function profileHref(target: {
  userId: string;
  accountType?: ProfileAccountType | string | null;
  name?: string;
  handle?: string;
  initials?: string;
  src?: StoreVisitSource;
}): string {
  if (target.accountType === 'buyer') {
    return `/buyer-other-profile${qs({
      userId: target.userId,
      name: target.name,
      handle: target.handle,
      initials: target.initials,
    })}`;
  }
  return `/seller-profile${qs({ id: target.userId, src: target.src })}`;
}

export type VideoFeedSource = 'creator' | 'product';

/**
 * The full-screen feed player scoped to one creator's videos (or to the videos
 * that feature one product), opened at `startPostId`.
 */
export function profileVideosHref(opts: {
  source?: VideoFeedSource;
  id: string;
  startPostId?: string | null;
  title?: string | null;
  exactPost?: boolean;
}): string {
  return `/profile-videos${qs({
    source: opts.source ?? 'creator',
    id: opts.id,
    startPostId: opts.startPostId ?? undefined,
    title: opts.title ?? undefined,
    exactPost: opts.exactPost ? '1' : undefined,
  })}`;
}

/** Every active listing of one seller (the "Shop N products" destination). */
export function profileProductsHref(opts: { sellerId: string; sellerName?: string | null; isOwner?: boolean }): string {
  return `/profile-products${qs({
    sellerId: opts.sellerId,
    sellerName: opts.sellerName ?? undefined,
    isOwner: opts.isOwner ? 'true' : undefined,
  })}`;
}

/** Product detail — the buyer page for shoppers, the seller's own product screen for its owner. */
export function productDetailHref(productId: string, opts: { isOwner?: boolean; sourcePostId?: string | null; src?: StoreVisitSource } = {}): string {
  if (opts.isOwner) return `/product-detail${qs({ id: productId })}`;
  return `/buyer-product-detail${qs({ productId, sourcePostId: opts.sourcePostId ?? undefined, src: opts.src })}`;
}

/** Follower / following list of a specific profile (omit userId for your own). */
export function connectionsHref(type: 'followers' | 'following', userId?: string | null): string {
  return `/connections${qs({ type, userId: userId ?? undefined })}`;
}

/**
 * DM with a seller about a product: opens (or reuses) the buyer↔seller product
 * thread with the product card staged in the composer.
 */
export function messageSellerAboutProductHref(opts: {
  sellerId: string;
  sellerName: string;
  productId: string;
  productName: string;
  productPriceCents?: number | null;
  productImageUri?: string | null;
}): string {
  const initials = opts.sellerName
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return `/buyer-conversation${qs({
    participantId: opts.sellerId,
    participantName: opts.sellerName,
    participantInitials: initials,
    participantAccountType: 'seller',
    type: 'buyer_to_seller_product',
    contextProductId: opts.productId,
    contextProductName: opts.productName,
    contextSellerName: opts.sellerName,
    contextProductPriceCents: opts.productPriceCents ?? undefined,
    contextProductImage: opts.productImageUri ?? undefined,
  })}`;
}

/** DM with a seller from their profile. */
export function messageSellerHref(opts: {
  sellerId: string;
  sellerName: string;
  handle?: string | null;
  initials?: string | null;
}): string {
  return `/buyer-conversation${qs({
    participantId: opts.sellerId,
    participantName: opts.sellerName,
    participantHandle: opts.handle ? `@${opts.handle.replace(/^@/, '')}` : undefined,
    participantInitials: opts.initials ?? undefined,
    participantAccountType: 'seller',
    type: 'buyer_to_seller',
  })}`;
}
