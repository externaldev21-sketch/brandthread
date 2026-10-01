/** Demo-only fixtures for the seller insights screens (?bt_preview=seller&demo=1). */
import type { AudienceStats, BestTimeStats, ContentApi, GoalProgress, ProductStats } from '@/services/sellerInsightsService';

const grid = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => {
  const evening = Math.max(0, 14 - Math.abs(h - 19) * 3);
  const lunch = Math.max(0, 8 - Math.abs(h - 12) * 3);
  const weekend = d === 0 || d === 6 ? 1.4 : 1;
  return Math.round((evening + lunch) * weekend);
}));

const products: ProductStats = {
  totals: { views: 1840, addToCarts: 212, purchases: 61, units: 74, revenueCents: 428600, viewToCartPct: 11.5, cartToPurchasePct: 28.8 },
  products: [
    { productId: 'p1', name: 'Heavyweight Tee', views: 820, uniqueViewers: 490, addToCarts: 96, purchases: 31, units: 38, revenueCents: 182400, viewToCartPct: 11.7, cartToPurchasePct: 32.3 },
    { productId: 'p2', name: 'Studio Hoodie', views: 560, uniqueViewers: 340, addToCarts: 71, purchases: 19, units: 22, revenueCents: 198000, viewToCartPct: 12.7, cartToPurchasePct: 26.8 },
    { productId: 'p3', name: 'Canvas Tote', views: 460, uniqueViewers: 280, addToCarts: 45, purchases: 11, units: 14, revenueCents: 48200, viewToCartPct: 9.8, cartToPurchasePct: 24.4 },
  ],
};

export const PREVIEW_INSIGHTS = {
  products,
  audience: {
    minGroupSize: 5,
    buyers: { suppressed: false, total: 58, new: 41, returning: 17 },
    viewers: { suppressed: false, total: 640, new: 505, returning: 135 },
    topCountries: [{ country: 'US', people: 39 }, { country: 'CA', people: 9 }, { country: 'GB', people: 6 }],
    topRegions: [{ country: 'US', region: 'CA', people: 14 }, { country: 'US', region: 'NY', people: 11 }, { country: 'US', region: 'TX', people: 7 }],
    hiddenLocations: 2,
  } as AudienceStats,
  bestTime: {
    grid, totalEvents: grid.flat().reduce((a, b) => a + b, 0), minEventsForRecommendation: 30,
    recommended: [{ day: 0, hour: 19, count: 27 }, { day: 6, hour: 19, count: 27 }, { day: 0, hour: 20, count: 24 }],
  } as BestTimeStats,
  goal: {
    metric: 'revenue', target: 500000, actual: 214300, progressPct: 42.9, remaining: 285700, expectedToDate: 250000,
    projected: 428600, projectedPct: 85.7, status: 'behind', month: { start: '', end: '', daysInMonth: 30 },
  } as GoalProgress,
  content: {
    totals: { views: 5200, uniqueViewers: 3100, likes: 410, comments: 38, shares: 52, productClicks: 190, addToCarts: 44, saves: 96, purchases: 12, revenueCents: 96400, avgWatchSeconds: 11.4, completionRate: null, followerGrowth: 63, profileVisits: 240 },
    posts: [
      { postId: 'v1', type: 'video', thumbnailUrl: null, caption: 'Drop 04 behind the scenes', views: 3100, likes: 260, comments: 21, saves: 60, shares: 30, productClicks: 120, purchases: 8, revenueCents: 64200, completionRate: null, publishedAt: '2026-09-10T15:00:00Z' },
      { postId: 'v2', type: 'video', thumbnailUrl: null, caption: 'Hoodie fit check', views: 2100, likes: 150, comments: 17, saves: 36, shares: 22, productClicks: 70, purchases: 4, revenueCents: 32200, completionRate: null, publishedAt: '2026-09-14T18:00:00Z' },
    ],
  } as ContentApi,
  contentEmpty: {
    totals: { views: 0, uniqueViewers: 0, likes: 0, comments: 0, shares: 0, productClicks: 0, addToCarts: 0, saves: 0, purchases: 0, revenueCents: 0, avgWatchSeconds: null, completionRate: null, followerGrowth: 0, profileVisits: 0 },
    posts: [],
  } as ContentApi,
};
