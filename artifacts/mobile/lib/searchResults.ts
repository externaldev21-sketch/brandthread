/**
 * Pure shaping helpers for the search screen's unified results
 * (api.public.searchAll) and its empty state. No react-native imports.
 */
import { followersLabel } from '@/lib/discoveryShelves';

export interface TrendingBrandItem {
  sellerId: string;
  name: string;
  handle: string;
  color: string;
  initials: string;
  verified?: boolean;
  followersLabel?: string;
}

export function handleFor(name: string): string {
  return `@${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`;
}

export function initialsFor(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

/**
 * Trending brands for the empty state: signal-ranked trending brands first
 * (GET /api/public/trending/brands — often only one or two on a young
 * marketplace), topped up with suggested brands (most-followed, then most
 * listings — GET /api/public/search/suggested). De-duped by seller.
 */
export function mergeTrendingBrands(
  trending: Array<{ id?: string; sellerId?: string; name: string; verified?: boolean; followerCount?: number }>,
  suggested: Array<{ sellerId: string; name: string; handle?: string; color?: string; initials?: string; followerCount?: number }>,
  colorFor: (id: string) => string,
  max = 5,
): TrendingBrandItem[] {
  const out: TrendingBrandItem[] = [];
  const seen = new Set<string>();
  const push = (b: { sellerId: string; name: string; handle?: string; color?: string; initials?: string; verified?: boolean; followerCount?: number }) => {
    if (!b.sellerId || seen.has(b.sellerId) || out.length >= max) return;
    seen.add(b.sellerId);
    out.push({
      sellerId: b.sellerId, name: b.name, handle: b.handle || handleFor(b.name),
      color: b.color ?? colorFor(b.sellerId), initials: b.initials ?? initialsFor(b.name),
      verified: !!b.verified, followersLabel: followersLabel(b.followerCount ?? 0),
    });
  };
  for (const t of trending) push({ ...t, sellerId: t.sellerId ?? t.id ?? '' });
  for (const s of suggested) push(s);
  return out;
}

/** Appends a fetched page, skipping ids already shown (offset paging after a refresh can overlap). */
export function appendPage<T extends { id: string }>(current: T[], page: T[]): T[] {
  const seen = new Set(current.map((i) => i.id));
  return [...current, ...page.filter((i) => !seen.has(i.id))];
}

export const SECTION_LABELS = { products: 'PRODUCTS', brands: 'BRANDS', people: 'PEOPLE', posts: 'POSTS' } as const;
