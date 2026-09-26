/**
 * Seeded PREVIEW live-shopping data (pure — no React Native / Expo imports,
 * so tests can import it directly).
 *
 * Uses the same preview brands, seller ids (`preview-seller-NN`) and product
 * ids (`preview-product-NN`) as the preview feed (FASHION_PREVIEW_POSTS in
 * app/(tabs)/feed.tsx), catalog (lib/previewCatalog.ts) and inbox
 * (lib/previewInboxData.ts), so a creator who is "live" in the pager is the
 * same creator whose feed-rail avatar, profile and Messages row show the
 * LIVE ring. Media indexes point into the 10 bundled runway clips.
 */

export interface PreviewBrandSeed {
  /** 0-based index into the 10 preview runway clips / catalog products. */
  index: number;
  sellerId: string;
  name: string;
  handle: string;
  initials: string;
  avatarColor: string;
  verified: boolean;
  followerCount: number;
}

const BRAND_ROWS: Array<[string, string, string, number]> = [
  // name, initials, avatarColor (same monochrome palette as the feed demo), followers
  ['Atelier Noire', 'AN', '#232323', 48200],
  ['Maison Vela', 'MV', '#474747', 91500],
  ['Saint Rue', 'SR', '#171717', 23900],
  ['Orison', 'OR', '#626262', 17400],
  ['Kuro Line', 'KL', '#0F0F0F', 35600],
  ['Forme 22', 'F2', '#353535', 12800],
  ['Astrae', 'AS', '#555555', 29300],
  ['Noma Archive', 'NA', '#292929', 8700],
  ['Echelon', 'EC', '#404040', 64100],
  ['Vale Studio', 'VS', '#1E1E1E', 15200],
];

export const PREVIEW_LIVE_BRANDS: PreviewBrandSeed[] = BRAND_ROWS.map(([name, initials, avatarColor, followerCount], index) => ({
  index,
  sellerId: `preview-seller-${String(index + 1).padStart(2, '0')}`,
  name,
  handle: `@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  initials,
  avatarColor,
  verified: index % 3 !== 2,
  followerCount,
}));

export function previewBrand(index: number): PreviewBrandSeed {
  return PREVIEW_LIVE_BRANDS[index];
}

export interface PreviewLiveStreamSeed {
  id: string;
  brandIndex: number;
  /** Which runway clip loops as this "stream". */
  videoIndex: number;
  title: string;
  baseViewers: number;
  baseLikes: number;
  /** Minutes ago the stream "started". */
  startedMinutesAgo: number;
  followed: boolean;
  /** Catalog product indexes shown in the stream's bag; the first is pinned. */
  productIndexes: number[];
  /** When set, this stream ends itself this long after the provider is
   *  created — demonstrates the pager removing an ended stream gracefully. */
  endsAfterMs?: number;
}

export const PREVIEW_LIVE_STREAMS: PreviewLiveStreamSeed[] = [
  { id: 'preview-live-01', brandIndex: 0, videoIndex: 0, title: 'Midnight tailoring — coat fittings', baseViewers: 2430, baseLikes: 18200, startedMinutesAgo: 24, followed: true, productIndexes: [0, 7, 2] },
  { id: 'preview-live-02', brandIndex: 1, videoIndex: 1, title: 'Silver hour: evening dresses', baseViewers: 5810, baseLikes: 44100, startedMinutesAgo: 51, followed: false, productIndexes: [1, 5, 9] },
  { id: 'preview-live-03', brandIndex: 4, videoIndex: 4, title: 'Layering 101 + restock drop', baseViewers: 1320, baseLikes: 9400, startedMinutesAgo: 12, followed: true, productIndexes: [4, 2] },
  { id: 'preview-live-04', brandIndex: 6, videoIndex: 6, title: 'Crystal mesh try-on', baseViewers: 980, baseLikes: 6100, startedMinutesAgo: 8, followed: false, productIndexes: [6, 3] },
  { id: 'preview-live-05', brandIndex: 8, videoIndex: 8, title: 'Power suiting Q&A', baseViewers: 3120, baseLikes: 21800, startedMinutesAgo: 37, followed: false, productIndexes: [8, 2, 0] },
  { id: 'preview-live-06', brandIndex: 9, videoIndex: 9, title: 'Last silk gowns of the season', baseViewers: 640, baseLikes: 3900, startedMinutesAgo: 66, followed: false, productIndexes: [9, 5], endsAfterMs: 150_000 },
];

export interface PreviewUpcomingSeed {
  id: string;
  brandIndex: number;
  title: string;
  /** Offset from "now" in minutes. */
  startsInMinutes: number;
}

export const PREVIEW_UPCOMING_LIVES: PreviewUpcomingSeed[] = [
  { id: 'preview-upcoming-01', brandIndex: 2, title: 'Tuxedo tailoring clinic', startsInMinutes: 95 },
  { id: 'preview-upcoming-02', brandIndex: 3, title: 'Bridal column set — first look', startsInMinutes: 60 * 22 },
  { id: 'preview-upcoming-03', brandIndex: 7, title: 'Archive trench restock', startsInMinutes: 60 * 47 },
];

/** Suggested creators for the empty state (brand indexes). */
export const PREVIEW_SUGGESTED_CREATORS: number[] = [5, 2, 7, 3];

/** Viewer usernames the scripted chat draws from. */
export const PREVIEW_CHAT_USERS = [
  'mila.wears', 'jun_archive', 'sofiastyled', 'theo.fits', 'noor.k', 'ava_in_black',
  'rafael.m', 'lune.studio', 'kaito', 'bea.vintage', 'odette', 'marcusdrip',
  'ines.l', 'yara_', 'felix.tailored', 'zoe.mono',
];

/**
 * Scripted chat lines. `{product}` is replaced with the pinned product's
 * name and `{brand}` with the host's name when the line is played.
 */
export const PREVIEW_CHAT_SCRIPT: Array<{ text: string; kind?: 'chat' | 'join' | 'purchase' | 'host' }> = [
  { text: 'joined', kind: 'join' },
  { text: 'obsessed with the {product} 😍' },
  { text: 'what size is the model wearing?' },
  { text: 'does it run true to size?' },
  { text: 'just bought the {product}!', kind: 'purchase' },
  { text: 'the drape on this is unreal' },
  { text: 'can you show the back?' },
  { text: 'Model is 5\'10" in a size S — true to size.', kind: 'host' },
  { text: '🔥🔥🔥' },
  { text: 'joined', kind: 'join' },
  { text: 'shipping to the UK?' },
  { text: 'need this for a wedding in June' },
  { text: 'is there a black colorway?' },
  { text: 'just bought the {product}!', kind: 'purchase' },
  { text: 'love {brand} so much' },
  { text: 'Restock of the {product} is live now — tap Buy.', kind: 'host' },
  { text: 'fabric content?' },
  { text: 'this is the one' },
  { text: 'joined', kind: 'join' },
  { text: 'how long until it ships?' },
];

export const PREVIEW_HOST_REPLIES = [
  'Thanks for watching, {user}! 🖤',
  '{user} great question — sizing chart is in the bag.',
  'Welcome in {user}!',
];

/** Small deterministic PRNG (mulberry32) so preview behaviour is stable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One viewer-count tick: drift by up to ±4% (at least ±1), biased slightly
 * upward early in a stream, never below 40% of the seed nor below 1.
 */
export function tickViewerCount(current: number, base: number, rand: () => number): number {
  const magnitude = Math.max(1, Math.round(current * 0.04 * rand()));
  const up = rand() < 0.56;
  const next = up ? current + magnitude : current - magnitude;
  return Math.max(1, Math.max(Math.round(base * 0.4), next));
}
