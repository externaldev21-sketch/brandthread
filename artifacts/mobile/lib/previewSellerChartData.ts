/**
 * Local, client-side seller sales-chart data for the dev web seller preview
 * (`?bt_preview=seller`) ONLY. Real signed-in sellers always go through
 * api.analytics.home() (lib/api.ts) and are completely untouched by this
 * file — see the branch in SellerHomeCommerceDashboard.tsx's analytics
 * effect.
 *
 * Why this exists: the preview has no real backing store, so previously the
 * dashboard's chart either called the real API (which the preview host
 * can't reach) or silently fell back to whatever stale/placeholder response
 * happened to be cached, producing exactly the bug this PR fixes — the same
 * bucket data reused for every range, so switching ranges changed nothing
 * but the range pill, and "Year" showed the current month's label repeated
 * instead of 12 distinct trailing months.
 *
 * Two modes (see lib/devPreview.ts's isPreviewFreshMode/isPreviewDemoMode):
 *   - 'fresh' (default — isPreviewFreshMode(), no ?demo=1): a flat $0
 *     baseline for every bucket, with correct range-appropriate x-axis
 *     labels. Never a fake curve or a fake percentage — matches Shopify's
 *     own zero-state chart ("$0.00 —").
 *   - 'demo' (isPreviewDemoMode() — ?bt_preview=seller&demo=1): a
 *     deterministic, realistic-looking curve that actually varies in shape
 *     between ranges, with a real previous-period comparison. Deterministic
 *     (seeded, not Math.random()) so the same range renders identically
 *     across re-renders/re-fetches instead of jittering.
 *
 * Bucket timestamps are built from local Date components (not UTC) so
 * lib/sellerHomeChartLabels.ts's bucketLabel — which reads local
 * getDay/getDate/getMonth/getHours — labels every bucket correctly, exactly
 * as it does for the real API's buckets.
 */
import { EMPTY_TRAFFIC_SOURCES, type SellerHomeAnalytics } from './sellerHomeAnalytics';

export type PreviewSellerChartRange = 'today' | 'week' | 'month' | 'year' | 'all';
export type PreviewSellerChartMode = 'fresh' | 'demo';

type Bucket = SellerHomeAnalytics['buckets'][number];

/** Small deterministic PRNG (mulberry32) — no Math.random, so demo data is stable across renders. */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localBucketIso(y: number, m: number, d: number, h = 0): string {
  return new Date(y, m, d, h, 0, 0, 0).toISOString();
}

/** The Sunday (local calendar) on/before `from` — the app's week starts
 *  Sunday (not ISO Monday-first), matching the real API's floorToLocalWeek. */
function mostRecentSunday(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = d.getDay(); // 0 Sun .. 6 Sat
  d.setDate(d.getDate() - day);
  return d;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

const SEED_BY_RANGE: Record<PreviewSellerChartRange, number> = {
  today: 1001, week: 2002, month: 3003, year: 4004, all: 5005,
};

function makeBucket(iso: string, mode: PreviewSellerChartMode, baseCents: number, shape: number, rand: () => number): Bucket {
  if (mode === 'fresh') return { bucket: iso, totalCents: 0, netCents: 0, orderCount: 0, visitorCount: 0 };
  const wobble = 0.55 + rand() * 0.9;
  const totalCents = Math.max(0, Math.round(baseCents * Math.max(0.05, shape) * wobble));
  const orderCount = totalCents > 0 ? Math.max(1, Math.round((totalCents / 4200) * (0.8 + rand() * 0.4))) : 0;
  const visitorCount = Math.max(orderCount, Math.round(orderCount * (6 + rand() * 6)));
  // A small, deterministic refund rate (~4%) so netCents is a real distinct
  // number from totalCents in demo mode too — never silently equal to gross.
  const netCents = Math.round(totalCents * 0.96);
  return { bucket: iso, totalCents, netCents, orderCount, visitorCount };
}

function buildBuckets(range: PreviewSellerChartRange, mode: PreviewSellerChartMode, now: Date): Bucket[] {
  const rand = mulberry32(SEED_BY_RANGE[range]);

  switch (range) {
    case 'today': {
      const y = now.getFullYear();
      const m = now.getMonth();
      const d = now.getDate();
      // Quiet overnight, busy midday/evening — a real intraday shape, not a flat repeat.
      return Array.from({ length: 24 }, (_, h) => {
        const shape = 0.15 + (Math.sin(((h - 6) / 24) * Math.PI * 2) + 1) * 0.45;
        return makeBucket(localBucketIso(y, m, d, h), mode, 3200, shape, rand);
      });
    }
    case 'week': {
      const sunday = mostRecentSunday(now);
      return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(sunday);
        day.setDate(sunday.getDate() + i);
        const dow = day.getDay();
        const weekendBump = dow === 0 || dow === 6 ? 1.35 : 0.85 + i * 0.03;
        return makeBucket(localBucketIso(day.getFullYear(), day.getMonth(), day.getDate()), mode, 18000, weekendBump, rand);
      });
    }
    case 'month': {
      const y = now.getFullYear();
      const m = now.getMonth();
      const total = daysInMonth(y, m);
      return Array.from({ length: total }, (_, i) => {
        const shape = 0.55 + Math.sin((i / total) * Math.PI * 3) * 0.35 + (i / total) * 0.3;
        return makeBucket(localBucketIso(y, m, i + 1), mode, 16500, shape, rand);
      });
    }
    case 'year': {
      // Calendar Jan–Dec of THIS year (not a trailing 12-month window — see
      // the real API's floorToLocalYear), future months not drawn. Every
      // bucket's own month is distinct — never the same one repeated (the
      // original reported bug).
      const y = now.getFullYear();
      const currentMonth = now.getMonth();
      return Array.from({ length: currentMonth + 1 }, (_, m) => {
        const shape = 0.45 + (m / 11) * 0.85 + Math.sin((m / 11) * Math.PI * 1.5) * 0.2;
        return makeBucket(localBucketIso(y, m, 1), mode, 480_000, shape, rand);
      });
    }
    case 'all':
    default: {
      const years = 4;
      const thisYear = now.getFullYear();
      return Array.from({ length: years }, (_, i) => {
        const year = thisYear - (years - 1 - i);
        const shape = 0.3 + (i / (years - 1)) * 1.15;
        return makeBucket(localBucketIso(year, 0, 1), mode, 4_200_000, shape, rand);
      });
    }
  }
}

/** Builds a full SellerHomeAnalytics snapshot for the given range/mode, purely client-side (no network). */
export function buildPreviewSellerAnalytics(
  range: PreviewSellerChartRange,
  mode: PreviewSellerChartMode,
  now: Date = new Date(),
): SellerHomeAnalytics {
  const buckets = buildBuckets(range, mode, now);
  const totalCents = buckets.reduce((sum, b) => sum + b.totalCents, 0);
  const netCents = buckets.reduce((sum, b) => sum + b.netCents, 0);
  const orderCount = buckets.reduce((sum, b) => sum + b.orderCount, 0);
  const visitorCount = buckets.reduce((sum, b) => sum + b.visitorCount, 0);

  const previous = mode === 'fresh'
    ? { totalCents: 0, netCents: 0, orderCount: 0, visitorCount: 0 }
    : (() => {
      const previousTotalCents = Math.round(totalCents * (0.72 + mulberry32(SEED_BY_RANGE[range] + 1)() * 0.35));
      return {
        totalCents: previousTotalCents,
        netCents: Math.round(previousTotalCents * 0.96),
        orderCount: Math.max(0, Math.round(orderCount * 0.85)),
        visitorCount: Math.max(0, Math.round(visitorCount * 0.88)),
      };
    })();

  // A deterministic (seeded, not Math.random) split of the same visitorCount
  // above into the four real source categories — a plausible-looking demo
  // shape, never a separate fabricated total. 'fresh' mode is a real
  // brand-new store on day one: every source is a real 0, exactly like
  // every other figure on this preview.
  const trafficSources = mode === 'fresh' ? EMPTY_TRAFFIC_SOURCES : buildDemoTrafficSources(visitorCount, range);

  return {
    range,
    totalCents,
    netCents,
    orderCount,
    visitorCount,
    conversionRate: visitorCount > 0 ? Math.round((orderCount / visitorCount) * 1000) / 10 : 0,
    averageOrderCents: orderCount > 0 ? Math.round(totalCents / orderCount) : 0,
    // Deterministic, small — Live gifting is a real but occasional revenue
    // stream, never the dominant number on the chart.
    threadCashReceivedCents: mode === 'fresh' ? 0 : Math.round(totalCents * 0.015),
    toFulfill: mode === 'fresh' ? 0 : Math.max(0, Math.round(orderCount * 0.08)),
    toCapture: 0,
    previous,
    trafficSources,
    buckets,
  };
}

const DEMO_TRAFFIC_WEIGHTS: Array<{ source: SellerHomeAnalytics['trafficSources'][number]['source']; weight: number }> = [
  { source: 'feed', weight: 0.42 },
  { source: 'search', weight: 0.24 },
  { source: 'profile', weight: 0.19 },
  { source: 'external', weight: 0.15 },
];

function buildDemoTrafficSources(visitorCount: number, range: PreviewSellerChartRange): SellerHomeAnalytics['trafficSources'] {
  const rand = mulberry32(SEED_BY_RANGE[range] + 2);
  const counts = DEMO_TRAFFIC_WEIGHTS.map(({ weight }) => Math.round(visitorCount * weight * (0.9 + rand() * 0.2)));
  const total = counts.reduce((sum, c) => sum + c, 0);
  return DEMO_TRAFFIC_WEIGHTS.map(({ source }, i) => ({
    source,
    count: counts[i],
    sharePercent: total > 0 ? Math.round((counts[i] / total) * 1000) / 10 : 0,
  }));
}
