/**
 * Budget-true reach estimate for Create Ad — mirrors the server's
 * artifacts/api-server/src/lib/ads/reachEstimate.ts exactly, so the range
 * updates live while the seller drags the daily-budget and duration sliders.
 * Keep the two files identical in behaviour (both have matching tests).
 *
 *   impressions = totalBudget / effectiveCPM × 1000      (total = daily × days)
 *   pool(days)  = audience × (1 − (1 − dailyActiveShare)^days)
 *   reach       = pool × (1 − e^(−impressions / pool))   (soft cap, diminishing returns)
 *
 * The inputs (CPM, audience) come from GET /api/ad-campaigns/reach-model.
 */

export const CPM_BAND = 1.25;
export const POOL_LOW_SHARE = 0.85;

export type ReachAudience = { total: number; dailyActive: number; source: 'measured' | 'floor' };
export type ReachModel = { cpmCents: number; audience: ReachAudience };
export type ReachEstimate = { low: number; high: number; impressions: number; reachablePool: number; saturation: number };

/**
 * Used until the live model loads (or when it can't — e.g. signed-out
 * preview): the server's defaults ($20 CPM, honest-floor audience).
 */
export const FALLBACK_REACH_MODEL: ReachModel = {
  cpmCents: 2000,
  audience: { total: 25_000, dailyActive: 4_000, source: 'floor' },
};

export function reachablePool(audience: Pick<ReachAudience, 'total' | 'dailyActive'>, days: number): number {
  if (audience.total <= 0) return 0;
  const share = Math.min(1, Math.max(0, audience.dailyActive / audience.total));
  return audience.total * (1 - Math.pow(1 - share, Math.max(1, days)));
}

export function expectedReach(impressions: number, pool: number): number {
  if (pool <= 0 || impressions <= 0) return 0;
  return pool * (1 - Math.exp(-impressions / pool));
}

export function estimateCampaignReach(input: { totalBudgetCents: number; durationDays: number; model: ReachModel }): ReachEstimate {
  const { totalBudgetCents, durationDays, model } = input;
  const cpm = Math.max(1, model.cpmCents);
  const impressions = (Math.max(0, totalBudgetCents) / cpm) * 1000;
  const pool = reachablePool(model.audience, durationDays);
  const low = expectedReach(impressions / CPM_BAND, pool * POOL_LOW_SHARE);
  const high = expectedReach(impressions * CPM_BAND, pool);
  return {
    low: Math.floor(low),
    high: Math.max(Math.floor(low), Math.floor(high)),
    impressions: Math.round(impressions),
    reachablePool: Math.round(pool),
    saturation: pool > 0 ? Math.min(1, expectedReach(impressions, pool) / pool) : 0,
  };
}

/** 6,550 → "6.5K", 24,673 → "24K", 980 → "980" — rounded down so a range never overstates. */
export function compactPeople(n: number): string {
  if (n >= 1_000_000) return `${(Math.floor(n / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.floor(n / 1000)}K`;
  if (n >= 1000) return `${(Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}K`;
  if (n >= 100) return String(Math.floor(n / 10) * 10);
  return String(Math.floor(n));
}

/** "4.2K–6.8K people" — always a range, never a fake precise number. */
export function formatReachRange(r: Pick<ReachEstimate, 'low' | 'high'>): string {
  const low = compactPeople(r.low);
  const high = compactPeople(r.high);
  return low === high ? `About ${high} people` : `${low}–${high} people`;
}
