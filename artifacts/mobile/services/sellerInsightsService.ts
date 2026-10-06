/**
 * Seller analytics reports: product stats, threads and videos, audience,
 * goals, advanced (Pro) and CSV/PDF export. Real API only; in the signed-out
 * web preview nothing calls the network (fresh mode is empty, &demo=1 is
 * fixtures from lib/previewSellerInsights.ts).
 *
 * Ranges are the Dashboard's own pills (Today / Week / Month / Year / All,
 * default Today) and `tz` is sent with every request so the API buckets on the
 * seller's local calendar.
 */
import { serviceRequest } from '@/lib/serviceConfig';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { previewInsights } from '@/lib/previewSellerInsights';

export type InsightRange = 'today' | 'week' | 'month' | 'year' | 'all';
/** Same ids and labels as the Dashboard chart's pills (SellerDashboardChart.DASHBOARD_RANGES). */
export const INSIGHT_RANGES: { key: InsightRange; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' }, { key: 'all', label: 'All' },
];
export const DEFAULT_INSIGHT_RANGE: InsightRange = 'today';

export interface InsightWindow { range: InsightRange; start: string; end: string; step: '1 hour' | '1 day' | '1 week' | '1 month' }

export interface ProductRow {
  productId: string; name: string; imageUrl: string | null; stock: number;
  views: number; uniqueViewers: number; addToCarts: number; purchases: number; units: number; revenueCents: number;
  viewToCartPct: number | null; cartToPurchasePct: number | null; viewToPurchasePct: number | null;
}
export interface ProductStats {
  window: InsightWindow;
  totals: { views: number; uniqueViewers: number; addToCarts: number; purchases: number; units: number; revenueCents: number; viewToCartPct: number | null; cartToPurchasePct: number | null; viewToPurchasePct: number | null };
  previous: { views: number; addToCarts: number; purchases: number; units: number; revenueCents: number } | null;
  deltas: { viewsPct: number | null; addToCartsPct: number | null; purchasesPct: number | null; revenuePct: number | null };
  buckets: { bucket: string; views: number; purchases: number }[];
  products: ProductRow[];
}

export interface ContentPost {
  postId: string; type: 'video' | 'slideshow' | 'image'; thumbnailUrl: string | null; caption: string;
  views: number; likes: number; comments: number; saves: number; shares: number; productClicks: number;
  purchases: number; revenueCents: number; avgWatchSeconds: number | null; publishedAt: string;
}
export interface ContentTotals {
  views: number; uniqueViewers: number; likes: number; comments: number; shares: number; saves: number; productClicks: number;
  addToCarts: number; purchases: number; revenueCents: number; avgWatchSeconds: number | null; followerGrowth: number; profileVisits: number;
}
export interface ContentStats {
  window: InsightWindow;
  totals: ContentTotals;
  previous: ContentTotals | null;
  deltas: { viewsPct: number | null; likesPct: number | null; commentsPct: number | null; sharesPct: number | null; savesPct: number | null; followerGrowthPct: number | null; revenuePct: number | null };
  buckets: { bucket: string; views: number; likes: number }[];
  byType: { type: 'video' | 'image' | 'slideshow'; posts: number; views: number }[];
  posts: ContentPost[];
}

export interface SplitCounts { suppressed: boolean; total: number | null; new: number | null; returning: number | null }
export interface AudienceStats {
  window: InsightWindow;
  minGroupSize: number;
  followers: { total: number; gained: number; previousGained: number | null; gainedPct: number | null };
  buckets: { bucket: string; followers: number }[];
  buyers: SplitCounts; viewers: SplitCounts;
  topCountries: { country: string; people: number }[];
  topRegions: { country: string; region: string; people: number }[];
  hiddenLocations: number;
  devices: { device: 'ios' | 'android' | 'web' | 'unknown'; visits: number; sharePct: number }[];
  deviceVisits: number;
}

export type GoalMetric = 'revenue' | 'orders' | 'visits' | 'followers' | 'units';
export type GoalPeriod = 'week' | 'month' | 'quarter' | 'year';
export const GOAL_METRICS: { key: GoalMetric; label: string }[] = [
  { key: 'revenue', label: 'Revenue' }, { key: 'orders', label: 'Orders' }, { key: 'units', label: 'Units sold' },
  { key: 'visits', label: 'Visits' }, { key: 'followers', label: 'New followers' },
];
export const GOAL_PERIODS: { key: GoalPeriod; label: string }[] = [
  { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }, { key: 'quarter', label: 'This quarter' }, { key: 'year', label: 'This year' },
];
export interface Goal {
  id: string; metric: GoalMetric; period: GoalPeriod; target: number; actual: number;
  window: { start: string; end: string };
  progressPct: number; remaining: number; expectedToDate: number; projected: number | null; projectedPct: number | null; daysLeft: number;
  status: 'achieved' | 'on_track' | 'behind' | 'not_started';
}

export interface AdvancedTotals {
  orders: number; revenueCents: number; refundedCents: number; refundedOrders: number; discountedOrders: number; discountCents: number;
  threadOrders: number; threadRevenueCents: number; buyers: number; units: number; visits: number;
  averageOrderCents: number; unitsPerOrder: number; conversionPct: number; refundRatePct: number;
}
export interface AdvancedStats {
  window: InsightWindow;
  totals: AdvancedTotals & { repeatBuyers: number; repeatBuyerPct: number };
  previous: AdvancedTotals | null;
  deltas: { averageOrderPct: number | null; conversionPct: number | null; refundRatePct: number | null; revenuePct: number | null };
  channels: { channel: 'threads' | 'store'; orders: number; revenueCents: number }[];
  buckets: { bucket: string; orders: number; revenueCents: number; averageOrderCents: number }[];
  topCustomers: { name: string; orders: number; totalCents: number; lastOrderAt: string }[];
}

export type ExportSectionKey = 'orders' | 'products' | 'analytics' | 'content' | 'audience' | 'goals';
export interface ExportFile { filename: string; mimeType: string; encoding: 'utf8' | 'base64'; data: string }

/** Minutes east of UTC, matching the analytics/home `tz` param. */
export function tzOffsetMinutes(): number { return -new Date().getTimezoneOffset(); }

/** 'demo' = fixtures, 'empty' = fresh preview, null = real API. */
export function previewMode(): 'demo' | 'empty' | null {
  if (!isSellerDevPreview()) return null;
  return isPreviewDemoMode() ? 'demo' : 'empty';
}

const q = (range: InsightRange) => `range=${range}&tz=${tzOffsetMinutes()}`;

export async function getProductStats(range: InsightRange): Promise<ProductStats> {
  const m = previewMode();
  if (m) return previewInsights(range, m).products;
  return serviceRequest<ProductStats>(`/api/analytics/insights/products?${q(range)}`, {}, false);
}
export async function getContentStats(range: InsightRange): Promise<ContentStats> {
  const m = previewMode();
  if (m) return previewInsights(range, m).content;
  return serviceRequest<ContentStats>(`/api/analytics/insights/content?${q(range)}`, {}, false);
}
export async function getAudienceStats(range: InsightRange): Promise<AudienceStats> {
  const m = previewMode();
  if (m) return previewInsights(range, m).audience;
  return serviceRequest<AudienceStats>(`/api/analytics/insights/audience?${q(range)}`, {}, false);
}
export async function getAdvancedStats(range: InsightRange): Promise<AdvancedStats> {
  const m = previewMode();
  if (m) return previewInsights(range, m).advanced;
  return serviceRequest<AdvancedStats>(`/api/analytics/insights/advanced?${q(range)}`, {}, false);
}
export async function getGoals(): Promise<Goal[]> {
  const m = previewMode();
  if (m) return previewInsights('month', m).goals;
  const r = await serviceRequest<{ goals: Goal[] }>(`/api/analytics/insights/goals?tz=${tzOffsetMinutes()}`, {}, false);
  return r.goals;
}
export async function createGoal(input: { metric: GoalMetric; period: GoalPeriod; target: number }): Promise<Goal[]> {
  if (previewMode()) throw new Error('Goals cannot be saved in the preview.');
  const r = await serviceRequest<{ goals: Goal[] }>('/api/analytics/insights/goals', {
    method: 'POST', body: JSON.stringify({ ...input, tz: tzOffsetMinutes() }),
  }, false);
  return r.goals;
}
export async function updateGoal(id: string, input: { metric: GoalMetric; period: GoalPeriod; target: number }): Promise<Goal[]> {
  if (previewMode()) throw new Error('Goals cannot be saved in the preview.');
  const r = await serviceRequest<{ goals: Goal[] }>(`/api/analytics/insights/goals/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ ...input, tz: tzOffsetMinutes() }),
  }, false);
  return r.goals;
}
export async function deleteGoal(id: string): Promise<void> {
  if (previewMode()) throw new Error('Goals cannot be deleted in the preview.');
  await serviceRequest(`/api/analytics/insights/goals/${encodeURIComponent(id)}`, { method: 'DELETE' }, false);
}
export async function requestExport(format: 'csv' | 'pdf', range: InsightRange, sections: ExportSectionKey[]): Promise<ExportFile> {
  if (previewMode()) throw new Error('Exports are not available in the preview.');
  return serviceRequest<ExportFile>('/api/analytics/insights/export', {
    method: 'POST', body: JSON.stringify({ format, range, sections, tz: tzOffsetMinutes() }),
  }, false);
}

/** Formats a goal value in its metric's unit. */
export function goalLabel(metric: GoalMetric): string {
  return GOAL_METRICS.find(m => m.key === metric)?.label ?? metric;
}
