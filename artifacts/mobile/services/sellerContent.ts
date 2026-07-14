// ─── Seller Content Service ────────────────────────────────────────────────────
// Demo data + service helpers for seller posts, profiles, and sounds.
// Swap these with real API calls when the backend is ready.

import type {
  SellerProfile, SellerPost, Sound, PostAnalytics,
  PostVisibility, PostHashtag, PostProductTag, AspectRatio,
} from './types';
import { DEMO_PRODUCTS } from './data';

export { DEMO_PRODUCTS };

// ─── Demo seller profile ──────────────────────────────────────────────────────

export const DEMO_SELLER_PROFILE: SellerProfile = {
  id:           'sp-1',
  sellerId:     'seller-1',
  brandName:    'Vault Studio',
  username:     'vaultstudio',
  bio:          'Premium streetwear crafted for those who move differently. Limited drops. No restocks.',
  website:      'vaultstudio.co',
  location:     'Los Angeles, CA',
  category:     'Streetwear',
  contactEmail: 'drops@vaultstudio.co',
  avatarColor:  '#39FF88',
  initials:     'VS',
  verified:     true,
  isPublic:     true,
  followers:    18420,
  following:    53,
  totalLikes:   142300,
  productCount: 6,
  postCount:    24,
  createdAt:    '2025-09-01',
};

// ─── Default post visibility ──────────────────────────────────────────────────

const DEFAULT_VISIBILITY: PostVisibility = {
  isPublic:      true,
  allowComments: true,
  allowReposts:  true,
  showLikeCount: true,
};

// ─── Demo analytics ───────────────────────────────────────────────────────────

function makeAnalytics(postId: string, views: number, likes: number, purchases?: number): PostAnalytics {
  const retentionData = Array.from({ length: 30 }, (_, i) => ({
    second:    i,
    viewerPct: Math.max(0.1, 1 - (i / 30) * 0.7 + (Math.sin(i * 0.4) * 0.05)),
  }));
  return {
    postId,
    views,
    uniqueViewers:    Math.round(views * 0.82),
    likes,
    comments:         Math.round(likes * 0.18),
    reposts:          Math.round(likes * 0.09),
    saves:            Math.round(likes * 0.22),
    shares:           Math.round(likes * 0.07),
    profileVisits:    Math.round(views * 0.06),
    productClicks:    Math.round(views * 0.12),
    addToCartActions: Math.round(views * 0.04),
    purchases:        purchases ?? Math.round(views * 0.015),
    revenue:          (purchases ?? Math.round(views * 0.015)) * 89.99,
    avgWatchTime:     18.4,
    completionRate:   0.67,
    retentionData,
    slideshowSwipeRate: 2.3,
    topCountries: [
      { country: 'United States', pct: 0.52 },
      { country: 'United Kingdom', pct: 0.14 },
      { country: 'Canada',         pct: 0.09 },
      { country: 'Australia',      pct: 0.07 },
      { country: 'Germany',        pct: 0.05 },
    ],
    peakHour: 19,
  };
}

// ─── Demo seller posts ────────────────────────────────────────────────────────

export const DEMO_SELLER_POSTS: SellerPost[] = [
  {
    id: 'post-1', sellerId: 'seller-1', brandId: 'sp-1',
    type: 'video', status: 'published',
    caption: 'New drop just landed 🔥 Oversized canvas jacket — limited run of 50. Link in bio.',
    hashtags: [
      { tag: '#streetwear', trending: true }, { tag: '#newdrop' },
      { tag: '#limitededition' }, { tag: '#brandthread' },
    ],
    thumbnailUri: undefined,
    aspectRatio: '9:16',
    videoDuration: 28,
    maxDuration: 30,
    mediaUrls: ['https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4'],
    overlays: [],
    productTags: [
      { productId: 'p5', productName: 'Canvas Cargo Jacket', price: 149.99, timestamp: 4 },
    ],
    visibility: DEFAULT_VISIBILITY,
    isPinned: true,
    isSellerContent: true,
    analytics: makeAnalytics('post-1', 53200, 2840, 34),
    createdAt: '2026-07-10T14:22:00Z',
    publishedAt: '2026-07-10T15:00:00Z',
  },
  {
    id: 'post-2', sellerId: 'seller-1', brandId: 'sp-1',
    type: 'slideshow', status: 'published',
    caption: 'Vintage Washed Tee — 8 colorways. Which one are you grabbing?',
    hashtags: [
      { tag: '#vintage' }, { tag: '#tee' }, { tag: '#fashion' }, { tag: '#ootd' },
    ],
    aspectRatio: '9:16',
    mediaUrls: [],
    overlays: [],
    productTags: [
      { productId: 'p1', productName: 'Vintage Washed Tee', price: 59.99, slideIndex: 0 },
    ],
    visibility: DEFAULT_VISIBILITY,
    isPinned: false,
    isSellerContent: true,
    analytics: makeAnalytics('post-2', 31800, 1720),
    createdAt: '2026-07-08T10:00:00Z',
    publishedAt: '2026-07-08T11:00:00Z',
  },
  {
    id: 'post-3', sellerId: 'seller-1', brandId: 'sp-1',
    type: 'video', status: 'published',
    caption: 'Grind now, shine later. The Cargo Sweatpants restock is live.',
    hashtags: [{ tag: '#cargo' }, { tag: '#restock' }, { tag: '#streetwear' }],
    aspectRatio: '9:16',
    videoDuration: 15,
    maxDuration: 15,
    mediaUrls: [],
    overlays: [],
    productTags: [
      { productId: 'p4', productName: 'Cargo Sweatpants', price: 79.99 },
    ],
    visibility: DEFAULT_VISIBILITY,
    isPinned: false,
    isSellerContent: true,
    analytics: makeAnalytics('post-3', 22100, 1180),
    createdAt: '2026-07-06T16:00:00Z',
    publishedAt: '2026-07-06T17:00:00Z',
  },
  {
    id: 'post-4', sellerId: 'seller-1', brandId: 'sp-1',
    type: 'announcement', status: 'published',
    caption: 'Archive Tee Vol.3 pre-order is now open. 50 units only. Ships September.',
    hashtags: [{ tag: '#preorder' }, { tag: '#archive' }, { tag: '#limitededition' }],
    aspectRatio: '1:1',
    mediaUrls: [],
    overlays: [],
    productTags: [
      { productId: 'p3', productName: 'Archive Tee Vol.3', price: 69.99 },
    ],
    visibility: DEFAULT_VISIBILITY,
    isPinned: false,
    isSellerContent: true,
    analytics: makeAnalytics('post-4', 18400, 940),
    createdAt: '2026-07-03T09:00:00Z',
    publishedAt: '2026-07-03T10:00:00Z',
  },
  {
    id: 'post-5', sellerId: 'seller-1', brandId: 'sp-1',
    type: 'behind_scenes', status: 'scheduled',
    caption: 'Behind the scenes of the Fall Drop campaign shoot.',
    hashtags: [{ tag: '#bts' }, { tag: '#falldrop' }, { tag: '#campaign' }],
    aspectRatio: '9:16',
    mediaUrls: [],
    overlays: [],
    productTags: [],
    visibility: DEFAULT_VISIBILITY,
    schedule: { scheduledAt: '2026-07-18T12:00:00Z', timezone: 'America/Los_Angeles' },
    isPinned: false,
    isSellerContent: true,
    analytics: makeAnalytics('post-5', 0, 0),
    createdAt: '2026-07-14T08:00:00Z',
    scheduledAt: '2026-07-18T12:00:00Z',
  },
  {
    id: 'post-6', sellerId: 'seller-1', brandId: 'sp-1',
    type: 'video', status: 'draft',
    caption: 'Heavyweight Crewneck — coming soon.',
    hashtags: [{ tag: '#crewneck' }, { tag: '#comingsoon' }],
    aspectRatio: '9:16',
    videoDuration: 10,
    maxDuration: 10,
    mediaUrls: [],
    overlays: [],
    productTags: [
      { productId: 'p6', productName: 'Heavyweight Crewneck', price: 99.99 },
    ],
    visibility: DEFAULT_VISIBILITY,
    isPinned: false,
    isSellerContent: true,
    analytics: makeAnalytics('post-6', 0, 0),
    createdAt: '2026-07-13T12:00:00Z',
  },
];

// ─── Demo sounds ──────────────────────────────────────────────────────────────
// All royalty-free / demo sounds. No copyrighted commercial music.

export const DEMO_SOUNDS: Sound[] = [
  {
    id: 's1', title: 'Street Pulse', artist: 'Demo Library',
    duration: 30, genre: 'Hip-Hop', category: 'trending',
    uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    isOriginal: false, isTrending: true, useCount: 84200,
    attribution: 'Royalty-free demo track',
  },
  {
    id: 's2', title: 'Neon Drift', artist: 'Demo Library',
    duration: 60, genre: 'Electronic', category: 'trending',
    uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    isOriginal: false, isTrending: true, useCount: 62100,
    attribution: 'Royalty-free demo track',
  },
  {
    id: 's3', title: 'Original Sound', artist: '@vaultstudio',
    duration: 28, genre: 'Original', category: 'original',
    uri: '', isOriginal: true, isTrending: false, useCount: 320,
  },
  {
    id: 's4', title: 'Late Night Grind', artist: 'Demo Library',
    duration: 45, genre: 'Lofi', category: 'saved',
    uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    isOriginal: false, isTrending: false, useCount: 21400,
    attribution: 'Royalty-free demo track',
  },
  {
    id: 's5', title: 'Drop Season', artist: 'Demo Library',
    duration: 15, genre: 'Trap', category: 'recent',
    uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    isOriginal: false, isTrending: false, useCount: 9800,
    attribution: 'Royalty-free demo track',
  },
  {
    id: 's6', title: 'Minimal Bounce', artist: 'Demo Library',
    duration: 30, genre: 'Electronic', category: 'royalty_free',
    uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    isOriginal: false, isTrending: false, useCount: 7300,
    attribution: 'Royalty-free demo track',
  },
  {
    id: 's7', title: 'Concrete Wave', artist: 'Demo Library',
    duration: 60, genre: 'Hip-Hop', category: 'royalty_free',
    uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
    isOriginal: false, isTrending: false, useCount: 5100,
    attribution: 'Royalty-free demo track',
  },
];

// ─── Products for tagging ─────────────────────────────────────────────────────

export const DEMO_PRODUCTS_FOR_TAG = DEMO_PRODUCTS.filter(
  p => p.status === 'active' || p.status === 'pre-order'
).map(p => ({
  id:    p.id,
  name:  p.name,
  price: p.price,
  status: p.status,
  salesModel: p.salesModel,
  colors: ['#4A3B7A', '#1E1540'] as [string, string],
}));

// ─── Suggested hashtags ───────────────────────────────────────────────────────

export const SUGGESTED_HASHTAGS: import('./types').PostHashtag[] = [
  { tag: '#streetwear',     trending: true,  postCount: 8_400_000 },
  { tag: '#fashion',        trending: true,  postCount: 42_100_000 },
  { tag: '#newdrop',        trending: true,  postCount: 1_200_000 },
  { tag: '#ootd',           trending: false, postCount: 28_000_000 },
  { tag: '#limitededition', trending: false, postCount: 620_000 },
  { tag: '#brandthread',    trending: false, postCount: 84_200 },
  { tag: '#style',          trending: false, postCount: 51_000_000 },
  { tag: '#drops',          trending: false, postCount: 940_000 },
  { tag: '#menswear',       trending: false, postCount: 6_300_000 },
  { tag: '#womenswear',     trending: false, postCount: 5_700_000 },
  { tag: '#vintage',        trending: false, postCount: 9_800_000 },
  { tag: '#hype',           trending: true,  postCount: 3_200_000 },
];

// ─── Service helpers ──────────────────────────────────────────────────────────

export function getSellerPosts(sellerId?: string): SellerPost[] {
  if (!sellerId) return DEMO_SELLER_POSTS;
  return DEMO_SELLER_POSTS.filter(p => p.sellerId === sellerId);
}

export function getPublishedPosts(sellerId?: string): SellerPost[] {
  return getSellerPosts(sellerId).filter(p => p.status === 'published');
}

export function getPostById(id: string): SellerPost | undefined {
  return DEMO_SELLER_POSTS.find(p => p.id === id);
}

export function getPostAnalytics(id: string): PostAnalytics | undefined {
  return getPostById(id)?.analytics;
}

export function getSellerProfile(_sellerId?: string): SellerProfile {
  return DEMO_SELLER_PROFILE;
}

// Thread eligibility: only published seller content
export function getThreadEligiblePosts(): SellerPost[] {
  return DEMO_SELLER_POSTS.filter(
    p =>
      p.status === 'published' &&
      p.isSellerContent === true &&
      (!p.schedule || new Date(p.schedule.scheduledAt) <= new Date())
  );
}
