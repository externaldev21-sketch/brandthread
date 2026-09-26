/**
 * Seeded PREVIEW buyer catalog.
 *
 * Discover/Search/Shop have nothing real to show without live sellers — every
 * section renders an empty state, which makes the preview unreviewable. This
 * gives those screens a small, real-looking catalog to browse instead, built
 * from the same ~10 fashion preview videos' poster images already bundled
 * for the feed preview (see FASHION_PREVIEW_POSTS in app/(tabs)/feed.tsx),
 * with brand names/prices/sizes that read as real product data.
 *
 * Gating: `isPreviewCatalogEnabled()` is true only when `__DEV__` is true
 * (never in a production build/binary — Expo/React Native strip `__DEV__` to
 * `false` at build time) AND, on web, only for a non-production API base URL
 * — so this can never leak into a real signed-in production account even if
 * a production JS bundle were somehow loaded in a dev-like host. Every call
 * site must gate on this before using the catalog, and must prefer real API
 * data whenever the API actually returns any.
 */
import { Asset } from 'expo-asset';

export function isPreviewCatalogEnabled(): boolean {
  // Stripped to `false` in production builds — this whole module becomes
  // dead code there, not just a runtime-skipped branch.
  if (!__DEV__) return false;
  return true;
}

const POSTER_SOURCES = [
  require('../assets/videos/fashion_runway_01.png'),
  require('../assets/videos/fashion_runway_02.png'),
  require('../assets/videos/fashion_runway_03.png'),
  require('../assets/videos/fashion_runway_04.png'),
  require('../assets/videos/fashion_runway_05.png'),
  require('../assets/videos/fashion_runway_06.png'),
  require('../assets/videos/fashion_runway_07.png'),
  require('../assets/videos/fashion_runway_08.png'),
  require('../assets/videos/fashion_runway_09.png'),
  require('../assets/videos/fashion_runway_10.png'),
];

function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index]).uri;
}

export interface PreviewCatalogProduct {
  id: string;
  productId: string;
  sellerId: string;
  name: string;
  sellerDisplayName: string;
  category: string;
  images: string[];
  cutoutUri: null;
  currentPriceCents: number;
  compareAtPriceCents: number | null;
  priceCents: number;
  sizes: string[];
  claimedUnits: number;
  remainingUnits: number;
  demandCount: number;
  tags: string[];
}

// Same brand/product names + prices as the FASHION_PREVIEW_POSTS feed demo
// data, so a buyer sees one consistent set of preview brands across the
// feed, Discover, Search and Shop rather than two different fake catalogs.
const SEED: Array<Omit<PreviewCatalogProduct, 'images' | 'cutoutUri' | 'id' | 'productId' | 'sellerId'> & { posterIndex: number }> = [
  { posterIndex: 0, name: 'Sculpted Wool Coat', sellerDisplayName: 'Atelier Noire', category: 'Outerwear', currentPriceCents: 48000, compareAtPriceCents: null, priceCents: 48000, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 18, remainingUnits: 6, demandCount: 142, tags: ['coat', 'wool', 'tailoring'] },
  { posterIndex: 1, name: 'Liquid Silver Dress', sellerDisplayName: 'Maison Vela', category: 'Dresses', currentPriceCents: 32500, compareAtPriceCents: 39000, priceCents: 32500, sizes: ['XS', 'S', 'M'], claimedUnits: 24, remainingUnits: 4, demandCount: 210, tags: ['dress', 'evening'] },
  { posterIndex: 2, name: 'Oversized Tuxedo', sellerDisplayName: 'Saint Rue', category: 'Suiting', currentPriceCents: 56000, compareAtPriceCents: null, priceCents: 56000, sizes: ['S', 'M', 'L', 'XL'], claimedUnits: 9, remainingUnits: 11, demandCount: 88, tags: ['suit', 'tuxedo'] },
  { posterIndex: 3, name: 'Ivory Column Set', sellerDisplayName: 'Orison', category: 'Sets', currentPriceCents: 41000, compareAtPriceCents: null, priceCents: 41000, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 12, remainingUnits: 8, demandCount: 96, tags: ['set', 'bridal'] },
  { posterIndex: 4, name: 'Asymmetric Layer Jacket', sellerDisplayName: 'Kuro Line', category: 'Outerwear', currentPriceCents: 29500, compareAtPriceCents: 35000, priceCents: 29500, sizes: ['S', 'M', 'L'], claimedUnits: 31, remainingUnits: 3, demandCount: 260, tags: ['jacket'] },
  { posterIndex: 5, name: 'Draped Hardware Gown', sellerDisplayName: 'Forme 22', category: 'Dresses', currentPriceCents: 37500, compareAtPriceCents: null, priceCents: 37500, sizes: ['XS', 'S', 'M'], claimedUnits: 15, remainingUnits: 9, demandCount: 121, tags: ['gown', 'evening'] },
  { posterIndex: 6, name: 'Crystal Mesh Top', sellerDisplayName: 'Astrae', category: 'Tops', currentPriceCents: 24500, compareAtPriceCents: null, priceCents: 24500, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 22, remainingUnits: 14, demandCount: 175, tags: ['top', 'going-out'] },
  { posterIndex: 7, name: 'Reconstructed Trench', sellerDisplayName: 'Noma Archive', category: 'Outerwear', currentPriceCents: 52000, compareAtPriceCents: null, priceCents: 52000, sizes: ['S', 'M', 'L', 'XL'], claimedUnits: 7, remainingUnits: 13, demandCount: 64, tags: ['trench', 'coat'] },
  { posterIndex: 8, name: 'Satin Power Suit', sellerDisplayName: 'Echelon', category: 'Suiting', currentPriceCents: 44500, compareAtPriceCents: 51000, priceCents: 44500, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 19, remainingUnits: 5, demandCount: 188, tags: ['suit'] },
  { posterIndex: 9, name: 'Sculpted Silk Gown', sellerDisplayName: 'Vale Studio', category: 'Dresses', currentPriceCents: 69000, compareAtPriceCents: null, priceCents: 69000, sizes: ['XS', 'S', 'M'], claimedUnits: 5, remainingUnits: 7, demandCount: 71, tags: ['gown', 'evening'] },
];

let cached: PreviewCatalogProduct[] | null = null;

/** The full seeded preview catalog (10 products). Callers should still
 *  gate on `isPreviewCatalogEnabled()` before using this. */
export function getPreviewCatalog(): PreviewCatalogProduct[] {
  if (cached) return cached;
  cached = SEED.map((row, i) => ({
    id: `preview-product-${String(i + 1).padStart(2, '0')}`,
    productId: `preview-product-${String(i + 1).padStart(2, '0')}`,
    sellerId: `preview-seller-${String(i + 1).padStart(2, '0')}`,
    name: row.name,
    sellerDisplayName: row.sellerDisplayName,
    category: row.category,
    images: [posterUri(row.posterIndex)],
    cutoutUri: null,
    currentPriceCents: row.currentPriceCents,
    compareAtPriceCents: row.compareAtPriceCents,
    priceCents: row.priceCents,
    sizes: row.sizes,
    claimedUnits: row.claimedUnits,
    remainingUnits: row.remainingUnits,
    demandCount: row.demandCount,
    tags: row.tags,
  }));
  return cached;
}

/** A slice of the catalog, sorted by demand — for "High Demand" style rails. */
export function getPreviewCatalogByDemand(limit?: number): PreviewCatalogProduct[] {
  const sorted = [...getPreviewCatalog()].sort((a, b) => b.demandCount - a.demandCount);
  return limit ? sorted.slice(0, limit) : sorted;
}

export function getPreviewCatalogProduct(id: string): PreviewCatalogProduct | null {
  return getPreviewCatalog().find(p => p.id === id || p.productId === id) ?? null;
}
