/**
 * Seeded PREVIEW data for the Discover grid/viewer/filters/people row.
 *
 * Same convention as previewCatalog.ts / previewActivity.ts: gated on
 * `isPreviewCatalogEnabled()`, reuses the same bundled poster images and the
 * same cast of preview brands (preview-seller-01..10) so a buyer sees one
 * consistent world across Feed, Discover, Search and Shop — never a gray
 * initials circle. Buyer "people" here are a distinct fixture cast (real
 * people don't share ids with the seller cast) so Fits/People read as an
 * actual community, not just brands relabeled.
 */
import { Asset } from 'expo-asset';
import { getPreviewCatalog } from './previewCatalog';
import { getPreviewSuggestedPeople } from './previewActivity';
import type { DiscoverPost, DiscoverBrandCard, DiscoverPersonSuggestion, DiscoverDrop } from './discoverFeed';

const POSTER_SOURCES = [
  require('../assets/videos/fashion_runway_01.jpg'),
  require('../assets/videos/fashion_runway_02.jpg'),
  require('../assets/videos/fashion_runway_03.jpg'),
  require('../assets/videos/fashion_runway_04.jpg'),
  require('../assets/videos/fashion_runway_05.jpg'),
  require('../assets/videos/fashion_runway_06.jpg'),
  require('../assets/videos/fashion_runway_07.jpg'),
  require('../assets/videos/fashion_runway_08.jpg'),
  require('../assets/videos/fashion_runway_09.jpg'),
  require('../assets/videos/fashion_runway_10.jpg'),
];
function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index % POSTER_SOURCES.length]).uri;
}

// Monochrome only (Discover stays on-brand) — dark-gray shades, not a
// colored identity per person.
const BUYERS = [
  { userId: 'preview-buyer-01', name: 'Jules Renner',  initials: 'JR', color: '#2A2A2E' },
  { userId: 'preview-buyer-02', name: 'Mika Solano',    initials: 'MS', color: '#333338' },
  { userId: 'preview-buyer-03', name: 'Theo Aldana',    initials: 'TA', color: '#242428' },
  { userId: 'preview-buyer-04', name: 'Priya Novak',    initials: 'PN', color: '#3A3A3F' },
  { userId: 'preview-buyer-05', name: 'Sasha Quill',    initials: 'SQ', color: '#2A2A2E' },
  { userId: 'preview-buyer-06', name: 'Devon Ashcroft', initials: 'DA', color: '#333338' },
  { userId: 'preview-buyer-07', name: 'Rue Kilbride',   initials: 'RK', color: '#242428' },
  { userId: 'preview-buyer-08', name: 'Nico Farro',     initials: 'NF', color: '#3A3A3F' },
];

const FIT_CAPTIONS = [
  'today\'s fit ✨', 'thrifted this whole look', 'obsessed with this coat rn',
  'ootd for the gallery opening', 'layering season is back', 'new drop, new fit',
  'this is the one', 'copping this before it sells out',
];

let cachedPosts: { forYou: DiscoverPost[]; fits: DiscoverPost[] } | null = null;

/** Seeded buyer + brand posts for the For You / Fits grid. */
export function getPreviewDiscoverPosts(filter: 'forYou' | 'fits'): DiscoverPost[] {
  if (!cachedPosts) {
    const catalog = getPreviewCatalog();
    const fits: DiscoverPost[] = BUYERS.map((buyer, i) => ({
      id: `preview-fit-${i + 1}`,
      authorId: buyer.userId,
      authorName: buyer.name,
      authorHandle: `@${buyer.name.toLowerCase().replace(/\s+/g, '')}`,
      authorInitials: buyer.initials,
      authorColor: buyer.color,
      authorAccountType: 'buyer' as const,
      media: (i % 4 === 0 ? 'video' : i % 5 === 0 ? 'slideshow' : 'photo') as DiscoverPost['media'],
      imageUri: posterUri(i + 3),
      caption: FIT_CAPTIONS[i % FIT_CAPTIONS.length],
      likesCount: 40 + i * 37,
      commentsCount: 2 + i * 3,
      // Buyers never tag products (owner correction) — a buyer post only
      // ever carries productTags when linked through Brandthread's own data
      // (e.g. a verified purchase), which doesn't exist yet. None here.
      createdAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    }));

    const brandPosts: DiscoverPost[] = catalog.map((product, i) => ({
      id: `preview-brand-post-${i + 1}`,
      authorId: product.sellerId,
      authorName: product.sellerDisplayName,
      authorHandle: `@${product.sellerDisplayName.toLowerCase().replace(/\s+/g, '')}`,
      authorInitials: product.sellerDisplayName[0].toUpperCase(),
      authorColor: '#111827',
      authorAccountType: 'seller' as const,
      authorVerified: true,
      media: (i % 3 === 0 ? 'video' : 'photo') as DiscoverPost['media'],
      imageUri: product.images[0],
      caption: product.name,
      likesCount: 200 + product.demandCount,
      commentsCount: 8 + Math.round(product.demandCount / 10),
      productTags: [{ productId: product.productId, productName: product.name, priceCents: product.priceCents }],
      createdAt: new Date(Date.now() - i * 5_400_000).toISOString(),
    }));

    cachedPosts = { forYou: [...brandPosts, ...fits], fits };
  }
  return cachedPosts[filter];
}

let cachedBrandCards: DiscoverBrandCard[] | null = null;

export function getPreviewBrandCards(): DiscoverBrandCard[] {
  if (!cachedBrandCards) {
    cachedBrandCards = getPreviewCatalog().map((p) => ({
      id: p.sellerId,
      name: p.sellerDisplayName,
      verified: true,
      imageUri: p.images[0],
      followersLabel: `${(1200 + p.demandCount * 8).toLocaleString()} followers`,
    }));
  }
  return cachedBrandCards;
}

/** Reuses the seeded "Suggested for you" cast (previewActivity.ts) so
 *  Activity and Discover's People row show the same faces. */
export function getPreviewDiscoverPeople(): DiscoverPersonSuggestion[] {
  return getPreviewSuggestedPeople();
}

let cachedDrops: DiscoverDrop[] | null = null;

export function getPreviewDrops(): DiscoverDrop[] {
  if (!cachedDrops) {
    const catalog = getPreviewCatalog();
    cachedDrops = catalog.slice(0, 6).map((p, i) => ({
      id: `preview-drop-${i + 1}`,
      name: p.name,
      brandName: p.sellerDisplayName,
      imageUri: p.images[0],
      releaseAt: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(),
      live: i === 0,
    }));
  }
  return cachedDrops;
}
