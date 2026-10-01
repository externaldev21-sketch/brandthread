/**
 * Seller analytics insights: product funnel, audience, best time to post,
 * monthly goals and CSV/PDF export. Real API only; in the signed-out web
 * preview nothing calls the network (fresh mode is empty, &demo=1 is fixtures).
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { PREVIEW_INSIGHTS } from '@/lib/previewSellerInsights';

export type InsightRange = '7d' | '30d' | '90d';
export const INSIGHT_RANGES: { key: InsightRange; label: string }[] = [
  { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' },
];

export interface ProductFunnelRow {
  productId: string; name: string; views: number; uniqueViewers: number; addToCarts: number;
  purchases: number; units: number; revenueCents: number; viewToCartPct: number | null; cartToPurchasePct: number | null;
}
export interface ProductStats {
  totals: { views: number; addToCarts: number; purchases: number; units: number; revenueCents: number; viewToCartPct: number | null; cartToPurchasePct: number | null };
  products: ProductFunnelRow[];
}
export interface SplitCounts { suppressed: boolean; total: number | null; new: number | null; returning: number | null }
export interface AudienceStats {
  minGroupSize: number; buyers: SplitCounts; viewers: SplitCounts;
  topCountries: { country: string; people: number }[];
  topRegions: { country: string; region: string; people: number }[];
  hiddenLocations: number;
}
export interface BestTimeStats {
  grid: number[][]; totalEvents: number; minEventsForRecommendation: number;
  recommended: { day: number; hour: number; count: number }[];
}
export type GoalMetric = 'revenue' | 'orders';
export interface GoalProgress {
  metric: GoalMetric; target: number; actual: number; progressPct: number; remaining: number;
  expectedToDate: number; projected: number | null; projectedPct: number | null;
  status: 'achieved' | 'on_track' | 'behind' | 'not_started';
  month: { start: string; end: string; daysInMonth: number };
}
export type ExportSectionKey = 'products' | 'content' | 'audience' | 'best_time' | 'goal';
export interface ExportFile { filename: string; mimeType: string; encoding: 'utf8' | 'base64'; data: string }

const EMPTY_SPLIT: SplitCounts = { suppressed: true, total: null, new: null, returning: null };
const EMPTY = {
  products: { totals: { views: 0, addToCarts: 0, purchases: 0, units: 0, revenueCents: 0, viewToCartPct: null, cartToPurchasePct: null }, products: [] } as ProductStats,
  audience: { minGroupSize: 5, buyers: EMPTY_SPLIT, viewers: EMPTY_SPLIT, topCountries: [], topRegions: [], hiddenLocations: 0 } as AudienceStats,
  bestTime: { grid: Array.from({ length: 7 }, () => Array<number>(24).fill(0)), totalEvents: 0, minEventsForRecommendation: 30, recommended: [] } as BestTimeStats,
};

/** Minutes east of UTC, matching the analytics/home `tz` param. */
export function tzOffsetMinutes(): number { return -new Date().getTimezoneOffset(); }

/** 'demo' = fixtures, 'empty' = fresh preview, null = real API. */
export function previewMode(): 'demo' | 'empty' | null {
  if (!isSellerDevPreview()) return null;
  return isPreviewDemoMode() ? 'demo' : 'empty';
}

const q = (range: InsightRange, extra = '') => `range=${range}&tz=${tzOffsetMinutes()}${extra}`;

export async function getProductStats(range: InsightRange): Promise<ProductStats> {
  const m = previewMode();
  if (m) return m === 'demo' ? PREVIEW_INSIGHTS.products : EMPTY.products;
  return serviceRequest<ProductStats>(`/api/analytics/insights/products?${q(range)}`, {}, false);
}
export async function getAudienceStats(range: InsightRange): Promise<AudienceStats> {
  const m = previewMode();
  if (m) return m === 'demo' ? PREVIEW_INSIGHTS.audience : EMPTY.audience;
  return serviceRequest<AudienceStats>(`/api/analytics/insights/audience?${q(range)}`, {}, false);
}
export async function getBestTime(range: InsightRange): Promise<BestTimeStats> {
  const m = previewMode();
  if (m) return m === 'demo' ? PREVIEW_INSIGHTS.bestTime : EMPTY.bestTime;
  return serviceRequest<BestTimeStats>(`/api/analytics/insights/best-time?${q(range)}`, {}, false);
}
export async function getGoal(): Promise<GoalProgress | null> {
  const m = previewMode();
  if (m) return m === 'demo' ? PREVIEW_INSIGHTS.goal : null;
  const r = await serviceRequest<{ goal: GoalProgress | null }>(`/api/analytics/insights/goals?tz=${tzOffsetMinutes()}`, {}, false);
  return r.goal;
}
export async function saveGoal(metric: GoalMetric, target: number): Promise<GoalProgress | null> {
  if (previewMode()) throw new Error('Goals cannot be saved in the preview.');
  const r = await serviceRequest<{ goal: GoalProgress | null }>(`/api/analytics/insights/goals?tz=${tzOffsetMinutes()}`, {
    method: 'PUT', body: JSON.stringify({ metric, target }),
  }, false);
  return r.goal;
}
export async function clearGoal(): Promise<void> {
  if (previewMode()) throw new Error('Goals cannot be cleared in the preview.');
  await serviceRequest('/api/analytics/insights/goals', { method: 'DELETE' }, false);
}
export async function requestExport(format: 'csv' | 'pdf', range: InsightRange, sections: ExportSectionKey[]): Promise<ExportFile> {
  if (previewMode()) throw new Error('Exports are not available in the preview.');
  return serviceRequest<ExportFile>('/api/analytics/insights/export', {
    method: 'POST', body: JSON.stringify({ format, range, sections, tz: tzOffsetMinutes() }),
  }, false);
}

export interface ContentApi {
  totals: {
    views: number; uniqueViewers: number; likes: number; comments: number; shares: number; productClicks: number;
    addToCarts: number; saves: number; purchases: number; revenueCents: number; avgWatchSeconds: number | null;
    completionRate: number | null; followerGrowth: number; profileVisits: number;
  };
  posts: {
    postId: string; type: 'video' | 'slideshow' | 'image'; thumbnailUrl: string | null; caption: string; views: number;
    likes: number; comments: number; saves: number; shares: number; productClicks: number; purchases: number;
    revenueCents: number; completionRate: number | null; publishedAt: string;
  }[];
}
export async function getContentApi(range: InsightRange): Promise<ContentApi> {
  const m = previewMode();
  if (m) return m === 'demo' ? PREVIEW_INSIGHTS.content : PREVIEW_INSIGHTS.contentEmpty;
  return serviceRequest<ContentApi>(`/api/analytics/insights/content?${q(range)}`, {}, false);
}
