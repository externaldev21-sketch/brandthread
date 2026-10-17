/**
 * Discover tab data shared by the screen (app/(buyer)/discover.tsx) and the
 * app-start warmer (lib/appStartPrefetch.ts), so the warmer fills exactly the
 * cache entries the screen paints from on its first frame.
 */
import type { EditorialTileItem } from '@/components/discover/EditorialTile';
import { getPreviewCatalog, getPreviewCatalogByDemand, isPreviewCatalogEnabled } from '@/lib/previewCatalog';
import { fetchDiscoverPage } from '@/lib/discoverFeed';
import { setCachedTabData } from '@/lib/tabDataCache';
import { prefetchImage } from '@/lib/prefetch';
import type { BrandthreadApi } from '@/lib/api';

export const DISCOVER_KEYS = {
  // `{ posts, nextCursor }` pages (lib/discoverPaging.ts). New key names so
  // a pre-cursor cached array (possibly an empty one) is never read back.
  forYou: 'discover:forYouFeed',
  fits: 'discover:fitsFeed',
  justDropped: 'discover:justDropped',
  highDemand: 'discover:highDemand',
  people: 'discover:people',
  brands: 'discover:brands',
  drops: 'discover:drops',
  featured: 'discover:featured',
  recommendedBrands: 'discover:recommendedBrands',
} as const;

export interface LiveProduct {
  id: string;
  name: string;
  sellerDisplayName?: string;
  images?: string[] | null;
  cutoutUri?: string | null;
  currentPriceCents?: number | null;
  claimedUnits?: number;
  remainingUnits?: number;
  demandCount?: number | null;
  endsAt?: string | null;
  tags?: string[];
  variants?: Array<{ priceCents?: number }>;
}

function pickImage(cutoutUri?: string | null, images?: string[] | null): string | undefined {
  return cutoutUri ?? (images ?? [])[0] ?? undefined;
}

export function mapToEditorialTile(prefix: string, row: LiveProduct, i: number): EditorialTileItem {
  const fallbackPrice = (row.variants ?? [])[0]?.priceCents ?? null;
  const remaining = typeof row.remainingUnits === 'number' ? row.remainingUnits : 0;
  return {
    id: `${prefix}_${row.id ?? i}`,
    productId: row.id,
    brand: row.sellerDisplayName ?? 'Seller',
    name: row.name,
    imageUri: pickImage(row.cutoutUri, row.images),
    initials: (row.name ?? 'P')[0].toUpperCase(),
    priceCents: row.currentPriceCents ?? fallbackPrice,
    isUrgent: remaining > 0 && remaining <= 4,
    endsAt: row.endsAt,
  };
}

export async function loadJustDropped(api: BrandthreadApi): Promise<EditorialTileItem[]> {
  const rows = await api.publicProducts.list({ limit: 8 });
  let safe: LiveProduct[] = Array.isArray(rows) ? rows : [];
  if (safe.length === 0 && isPreviewCatalogEnabled()) safe = getPreviewCatalog();
  return safe.map((row, i) => mapToEditorialTile('jd', row, i));
}

export async function loadHighDemand(api: BrandthreadApi): Promise<EditorialTileItem[]> {
  const rows = await api.publicProducts.highDemand(6);
  let safe: LiveProduct[] = Array.isArray(rows) ? rows : [];
  if (safe.length === 0 && isPreviewCatalogEnabled()) safe = getPreviewCatalogByDemand(6);
  return safe.map((row, i) => mapToEditorialTile('hd', row, i));
}

/** First page of the For You grid plus its two product rails, written to
 *  the same cache keys the Discover screen seeds its state from. */
export async function warmDiscoverTab(api: BrandthreadApi, isSignedIn: boolean): Promise<void> {
  const [forYou, justDropped, highDemand] = await Promise.all([
    fetchDiscoverPage({ api, isSignedIn, filter: 'forYou', limit: 24 }).catch(() => undefined),
    loadJustDropped(api).catch(() => undefined),
    loadHighDemand(api).catch(() => undefined),
  ]);
  // Never cache an empty page over content a previous visit showed.
  if (forYou && forYou.posts.length > 0) setCachedTabData(DISCOVER_KEYS.forYou, forYou);
  if (justDropped) setCachedTabData(DISCOVER_KEYS.justDropped, justDropped);
  if (highDemand) setCachedTabData(DISCOVER_KEYS.highDemand, highDemand);
  forYou?.posts.slice(0, 9).forEach((post) => prefetchImage(post.imageUri));
}
