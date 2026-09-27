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
  /** Preview-only brand details; optional so existing product consumers remain compatible. */
  sellerBio?: string;
  sellerAvatarUrl?: string;
  rating?: { avgRating: number; totalCount: number };
}

export interface PreviewSellerIdentity {
  sellerId: string;
  displayName: string;
  handle: string;
  bio: string;
  avatarUrl: string;
  initials: string;
  color: string;
}

// Stable royalty-free Unsplash CDN images (not random/source.unsplash.com
// redirects); bundled runway posters remain available as a local product-image
// fallback if a preview is viewed without a network connection.
const PHOTO_IDS = [
  'photo-1539109136881-3be0616acf4b', 'photo-1529139574466-a303027c1d8b',
  'photo-1490481651871-ab68de25d43d', 'photo-1483985988355-763728e1935b',
  'photo-1525507119028-ed4c629a60a3', 'photo-1515886657613-9f3515b0c78f',
  'photo-1551232864-3f0890e580d9', 'photo-1509631179647-0177331693ae',
  'photo-1539533018447-63fcce2678e3', 'photo-1548126032-079a0fb0099d',
  'photo-1550614000-4895a10e1bfd', 'photo-1524504388940-b1c1722653e1',
  'photo-1487222477894-8943e31ef7b2', 'photo-1529139574466-a303027c1d8b',
  'photo-1496747611176-843222e1e57c', 'photo-1512316609839-ce289d3eba0a',
  'photo-1503342217505-b0a15ec3261c', 'photo-1515886657613-9f3515b0c78f',
  'photo-1554412933-514a83d2f3c8', 'photo-1485230895905-ec40ba36b9bc',
  'photo-1529139574466-a303027c1d8b', 'photo-1539109136881-3be0616acf4b',
  'photo-1515886657613-9f3515b0c78f', 'photo-1490481651871-ab68de25d43d',
  'photo-1509631179647-0177331693ae', 'photo-1525507119028-ed4c629a60a3',
  'photo-1551232864-3f0890e580d9', 'photo-1548126032-079a0fb0099d',
  'photo-1550614000-4895a10e1bfd', 'photo-1539533018447-63fcce2678e3',
];
const photoUrl = (index: number, width = 900) =>
  `https://images.unsplash.com/${PHOTO_IDS[index % PHOTO_IDS.length]}?auto=format&fit=crop&w=${width}&q=82`;

export const PREVIEW_SELLERS: PreviewSellerIdentity[] = [
  { sellerId: 'preview-seller-01', displayName: 'Atelier Noire', handle: '@atelier_noire', bio: 'Quietly bold essentials, cut in beautiful natural fibers and made to be worn for years.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80', initials: 'AN', color: '#2E2A26' },
  { sellerId: 'preview-seller-02', displayName: 'Maison Vela', handle: '@maison_vela', bio: 'Modern occasionwear with a little more light, movement, and romance.', avatarUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=240&h=240&q=80', initials: 'MV', color: '#7C3AED' },
  { sellerId: 'preview-seller-03', displayName: 'Saint Rue', handle: '@saint_rue', bio: 'Paris-inspired tailoring for people who make their own rules.', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&h=240&q=80', initials: 'SR', color: '#111827' },
  { sellerId: 'preview-seller-04', displayName: 'Orison', handle: '@orison', bio: 'Considered sets and heirloom-worthy pieces for life’s meaningful days.', avatarUrl: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=240&h=240&q=80', initials: 'OR', color: '#D6D3D1' },
  { sellerId: 'preview-seller-05', displayName: 'Kuro Line', handle: '@kuro_line', bio: 'Architectural layers with a useful edge, designed and finished in small runs.', avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=240&h=240&q=80', initials: 'KL', color: '#1F2937' },
  { sellerId: 'preview-seller-06', displayName: 'Forme 22', handle: '@forme22', bio: 'Sculptural eveningwear that celebrates shape, texture, and confidence.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&h=240&q=80', initials: 'F2', color: '#B45309' },
  { sellerId: 'preview-seller-07', displayName: 'Astrae', handle: '@astrae', bio: 'After-dark separates, glimmering details, and pieces made for the dance floor.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80', initials: 'AS', color: '#0EA5E9' },
  { sellerId: 'preview-seller-08', displayName: 'Noma Archive', handle: '@noma_archive', bio: 'Reworked classics and one-of-a-kind finds with a story behind every stitch.', avatarUrl: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=240&h=240&q=80', initials: 'NA', color: '#65A30D' },
  { sellerId: 'preview-seller-09', displayName: 'Echelon', handle: '@echelon', bio: 'Polished power pieces: precise fit, expressive color, no compromises.', avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=240&h=240&q=80', initials: 'EC', color: '#DB2777' },
  { sellerId: 'preview-seller-10', displayName: 'Vale Studio', handle: '@vale_studio', bio: 'Fluid silk and thoughtful occasionwear, designed in New York.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&h=240&q=80', initials: 'VS', color: '#EA580C' },
  { sellerId: 'preview-seller-11', displayName: 'Common Hours', handle: '@commonhours', bio: 'Easy everyday pieces in responsible fabrics, made for repeat wear.', avatarUrl: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=240&h=240&q=80', initials: 'CH', color: '#256D5A' },
  { sellerId: 'preview-seller-12', displayName: 'Morrow Form', handle: '@morrowform', bio: 'Clean silhouettes and soft structure for whatever the day brings.', avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&h=240&q=80', initials: 'MF', color: '#A16207' },
  { sellerId: 'preview-seller-13', displayName: 'Ciel Atelier', handle: '@cielatelier', bio: 'Airy, artful dressing inspired by the coast and made in small batches.', avatarUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=240&h=240&q=80', initials: 'CA', color: '#2563EB' },
  { sellerId: 'preview-seller-14', displayName: 'Soft Theory', handle: '@softtheory', bio: 'Comfort-first knitwear with thoughtful proportions and tactile yarns.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&h=240&q=80', initials: 'ST', color: '#9333EA' },
  { sellerId: 'preview-seller-15', displayName: 'Studio Lune', handle: '@studiolune', bio: 'Small-run statement pieces for nights that become favorite stories.', avatarUrl: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=240&h=240&q=80', initials: 'SL', color: '#BE185D' },
  { sellerId: 'preview-seller-16', displayName: 'Field Notes', handle: '@fieldnoteswear', bio: 'Utility-minded staples, softened by natural textures and careful details.', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&h=240&q=80', initials: 'FN', color: '#4D7C0F' },
  { sellerId: 'preview-seller-17', displayName: 'Pale Objects', handle: '@paleobjects', bio: 'Minimal accessories and wardrobe anchors with a sculptural point of view.', avatarUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=240&h=240&q=80', initials: 'PO', color: '#475569' },
  { sellerId: 'preview-seller-18', displayName: 'Sunday Assembly', handle: '@sundayassembly', bio: 'Colorful, optimistic pieces for slow mornings and full calendars alike.', avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=240&h=240&q=80', initials: 'SA', color: '#C2410C' },
  { sellerId: 'preview-seller-19', displayName: 'Alder & Ash', handle: '@alderandash', bio: 'Modern heritage clothing built around quality materials and lasting fit.', avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&h=240&q=80', initials: 'AA', color: '#854D0E' },
  { sellerId: 'preview-seller-20', displayName: 'After Image', handle: '@afterimage', bio: 'Expressive occasion pieces designed to feel like you, only louder.', avatarUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=240&h=240&q=80', initials: 'AI', color: '#7E22CE' },
];

type ProductSeed = Omit<PreviewCatalogProduct, 'images' | 'cutoutUri' | 'id' | 'productId' | 'sellerId' | 'sellerBio' | 'sellerAvatarUrl' | 'rating'> & { sellerIndex: number; posterIndex: number };

// The first ten entries intentionally retain their public ids and names/prices;
// the remaining two pieces per original label and three per new label create a
// coherent 60-product assortment without changing existing preview links.
const FIRST_TEN: ProductSeed[] = [
  { sellerIndex: 0, posterIndex: 0, name: 'Sculpted Wool Coat', sellerDisplayName: 'Atelier Noire', category: 'Outerwear', currentPriceCents: 48000, compareAtPriceCents: null, priceCents: 48000, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 18, remainingUnits: 6, demandCount: 142, tags: ['coat', 'wool', 'tailoring'] },
  { sellerIndex: 1, posterIndex: 1, name: 'Liquid Silver Dress', sellerDisplayName: 'Maison Vela', category: 'Dresses', currentPriceCents: 32500, compareAtPriceCents: 39000, priceCents: 32500, sizes: ['XS', 'S', 'M'], claimedUnits: 24, remainingUnits: 4, demandCount: 210, tags: ['dress', 'evening'] },
  { sellerIndex: 2, posterIndex: 2, name: 'Oversized Tuxedo', sellerDisplayName: 'Saint Rue', category: 'Suiting', currentPriceCents: 56000, compareAtPriceCents: null, priceCents: 56000, sizes: ['S', 'M', 'L', 'XL'], claimedUnits: 9, remainingUnits: 11, demandCount: 88, tags: ['suit', 'tuxedo'] },
  { sellerIndex: 3, posterIndex: 3, name: 'Ivory Column Set', sellerDisplayName: 'Orison', category: 'Sets', currentPriceCents: 41000, compareAtPriceCents: null, priceCents: 41000, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 12, remainingUnits: 8, demandCount: 96, tags: ['set', 'bridal'] },
  { sellerIndex: 4, posterIndex: 4, name: 'Asymmetric Layer Jacket', sellerDisplayName: 'Kuro Line', category: 'Outerwear', currentPriceCents: 29500, compareAtPriceCents: 35000, priceCents: 29500, sizes: ['S', 'M', 'L'], claimedUnits: 31, remainingUnits: 3, demandCount: 260, tags: ['jacket'] },
  { sellerIndex: 5, posterIndex: 5, name: 'Draped Hardware Gown', sellerDisplayName: 'Forme 22', category: 'Dresses', currentPriceCents: 37500, compareAtPriceCents: null, priceCents: 37500, sizes: ['XS', 'S', 'M'], claimedUnits: 15, remainingUnits: 9, demandCount: 121, tags: ['gown', 'evening'] },
  { sellerIndex: 6, posterIndex: 6, name: 'Crystal Mesh Top', sellerDisplayName: 'Astrae', category: 'Tops', currentPriceCents: 24500, compareAtPriceCents: null, priceCents: 24500, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 22, remainingUnits: 14, demandCount: 175, tags: ['top', 'going-out'] },
  { sellerIndex: 7, posterIndex: 7, name: 'Reconstructed Trench', sellerDisplayName: 'Noma Archive', category: 'Outerwear', currentPriceCents: 52000, compareAtPriceCents: null, priceCents: 52000, sizes: ['S', 'M', 'L', 'XL'], claimedUnits: 7, remainingUnits: 13, demandCount: 64, tags: ['trench', 'coat'] },
  { sellerIndex: 8, posterIndex: 8, name: 'Satin Power Suit', sellerDisplayName: 'Echelon', category: 'Suiting', currentPriceCents: 44500, compareAtPriceCents: 51000, priceCents: 44500, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 19, remainingUnits: 5, demandCount: 188, tags: ['suit'] },
  { sellerIndex: 9, posterIndex: 9, name: 'Sculpted Silk Gown', sellerDisplayName: 'Vale Studio', category: 'Dresses', currentPriceCents: 69000, compareAtPriceCents: null, priceCents: 69000, sizes: ['XS', 'S', 'M'], claimedUnits: 5, remainingUnits: 7, demandCount: 71, tags: ['gown', 'evening'] },
];

const ADDITIONAL_NAMES = [
  'Double-Face Wool Blazer', 'Soft Tailored Trouser', 'Everyday Merino Cardigan',
  'Bias-Cut Satin Skirt', 'Sculpted Evening Top', 'Draped Crepe Midi',
  'City Tuxedo Vest', 'Pleated Wide-Leg Trouser', 'Relaxed Linen Blazer',
  'Textured Bouclé Jacket', 'Cotton Poplin Shirt', 'Fine-Gauge Knit Polo',
  'Twist-Front Jersey Top', 'Washed Silk Camisole', 'Ribbed Column Dress',
  'Gathered Chiffon Blouse', 'Fluid Satin Slip', 'Modern Wrap Dress',
  'Hand-Finished Denim Jacket', 'Soft Structure Blazer', 'Wide-Leg Travel Pant',
  'Convertible Utility Vest', 'Reversible Quilted Coat', 'Lightweight Field Jacket',
  'Cashmere Blend Crewneck', 'Open-Stitch Summer Knit', 'Relaxed Cable Sweater',
  'Merino Rib Tank', 'Satin-Back Crepe Skirt', 'Bias Midi Slip Skirt',
  'Soft Leather Shoulder Bag', 'Sculptural Hoop Earrings', 'Woven Leather Belt',
  'Minimal Crossbody Pouch', 'Tonal Knit Set', 'Linen Resort Shirt',
  'Drawstring Tailored Short', 'Cotton Day Dress', 'Silk-Blend Scarf',
  'Everyday Ribbed Tee', 'Relaxed Denim Trouser', 'Pleated Occasion Skirt',
  'Soft Suede Overshirt', 'Cropped Double-Knit Jacket', 'Textured Resort Dress',
  'Fine Wool Straight Coat', 'Twist-Detail Knit Top', 'Weekend Zip Hoodie',
  'Linen Blend Co-ord', 'Draped Evening Separates',
];
const CATEGORIES = ['Outerwear', 'Tops', 'Bottoms', 'Dresses', 'Knitwear', 'Accessories', 'Sets', 'Suiting'];
const SIZES_BY_CATEGORY: Record<string, string[]> = {
  Outerwear: ['XS', 'S', 'M', 'L', 'XL'], Tops: ['XS', 'S', 'M', 'L', 'XL'],
  Bottoms: ['0', '2', '4', '6', '8', '10'], Dresses: ['XS', 'S', 'M', 'L'],
  Knitwear: ['XS', 'S', 'M', 'L'], Accessories: ['One Size'],
  Sets: ['XS', 'S', 'M', 'L'], Suiting: ['XS', 'S', 'M', 'L', 'XL'],
};

const EXTRA_PRODUCTS: ProductSeed[] = ADDITIONAL_NAMES.map((name, index) => {
  const category = CATEGORIES[index % CATEGORIES.length];
  const sellerIndex = index < 20 ? Math.floor(index / 2) : 10 + Math.floor((index - 20) / 3);
  const priceCents = 12800 + ((index * 7913) % 56200);
  return {
    sellerIndex, posterIndex: (index + 1) % 10, name,
    sellerDisplayName: PREVIEW_SELLERS[sellerIndex].displayName, category,
    currentPriceCents: priceCents,
    compareAtPriceCents: index % 4 === 1 ? priceCents + 5000 : null,
    priceCents, sizes: SIZES_BY_CATEGORY[category],
    claimedUnits: 4 + ((index * 7) % 34), remainingUnits: 3 + ((index * 11) % 18),
    demandCount: 38 + ((index * 47) % 255),
    tags: [name.toLowerCase().split(' ').slice(-1)[0], category.toLowerCase()],
  };
});

const SEED = [...FIRST_TEN, ...EXTRA_PRODUCTS];

let cached: PreviewCatalogProduct[] | null = null;

/** The full seeded preview catalog (60 products). Callers should still
 *  gate on `isPreviewCatalogEnabled()` before using this. */
export function getPreviewCatalog(): PreviewCatalogProduct[] {
  if (cached) return cached;
  cached = SEED.map((row, i) => {
    const seller = PREVIEW_SELLERS[row.sellerIndex];
    return {
      id: `preview-product-${String(i + 1).padStart(2, '0')}`,
      productId: `preview-product-${String(i + 1).padStart(2, '0')}`,
      sellerId: seller.sellerId,
      name: row.name,
      sellerDisplayName: row.sellerDisplayName,
      category: row.category,
      images: [
        photoUrl(i * 2),
        photoUrl(i * 2 + 1),
        posterUri(row.posterIndex),
      ],
      cutoutUri: null,
      currentPriceCents: row.currentPriceCents,
      compareAtPriceCents: row.compareAtPriceCents,
      priceCents: row.priceCents,
      sizes: row.sizes,
      claimedUnits: row.claimedUnits,
      remainingUnits: row.remainingUnits,
      demandCount: row.demandCount,
      tags: row.tags,
      sellerBio: seller.bio,
      sellerAvatarUrl: seller.avatarUrl,
      rating: { avgRating: 4.2 + ((i * 7) % 9) / 10, totalCount: 12 + ((i * 23) % 280) },
    };
  });
  return cached;
}

/** Consistent preview brands for activity, inbox and future profile surfaces. */
export function getPreviewSellers(): PreviewSellerIdentity[] {
  return PREVIEW_SELLERS;
}

/** A slice of the catalog, sorted by demand — for "High Demand" style rails. */
export function getPreviewCatalogByDemand(limit?: number): PreviewCatalogProduct[] {
  const sorted = [...getPreviewCatalog()].sort((a, b) => b.demandCount - a.demandCount);
  return limit ? sorted.slice(0, limit) : sorted;
}

export function getPreviewCatalogProduct(id: string): PreviewCatalogProduct | null {
  return getPreviewCatalog().find(p => p.id === id || p.productId === id) ?? null;
}
