/**
 * Client types + pure formatting for the seller's live summary
 * (GET /api/live/:id/analytics, GET /api/live/analytics/recent —
 * api-server routes/live-analytics.ts). Money stays integer cents until
 * display.
 */
import { formatCents } from '@/lib/money';

export interface LiveAnalytics {
  stream: {
    id: string;
    title: string;
    status: 'live' | 'ended' | string;
    startedAt: string;
    endedAt: string | null;
    thumbnailUrl: string | null;
    durationSeconds: number;
  };
  audience: { peakViewers: number; uniqueViewers: number; comments: number; likes: number };
  gifts: { count: number; threadCashCents: number };
  sales: {
    orders: number;
    buyers: number;
    units: number;
    grossCents: number;
    refundedCents: number;
    revenueCents: number;
    conversionRate: number | null;
  };
  topProducts: Array<{ productId: string | null; name: string; imageUrl: string | null; units: number; revenueCents: number }>;
  cohosts: Array<{ userId: string; displayName: string; username: string; avatarUrl: string | null; joinedAt: string; orders: number; revenueCents: number }>;
}

export interface LiveAnalyticsListItem {
  streamId: string;
  title: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number;
  peakViewers: number;
  orders: number;
  revenueCents: number;
}

/** "1h 04m", "12m 05s", "45s". */
export function formatLiveDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** 0.0425 → "4.3%"; null (nobody watched) → "–". */
export function formatConversion(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '–';
  const pct = rate * 100;
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** Compact counts: 980, 1.2K, 34K, 1.1M. */
export function formatCount(n: number): string {
  const v = Math.max(0, Math.round(n || 0));
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}K`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** "Oct 7" (same year) or "Oct 7, 2025". */
export function formatLiveDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "Jordan bought Wool Overshirt" / "Jordan bought 2 × Wool Overshirt". */
export function purchaseLine(p: { buyerFirstName: string; productName: string; units: number }): string {
  const who = p.buyerFirstName?.trim() || 'Someone';
  const what = p.units > 1 ? `${p.units} × ${p.productName}` : p.productName;
  return `${who} bought ${what}`;
}

export function revenueLabel(cents: number): string {
  return formatCents(Math.max(0, Math.round(cents || 0)));
}
