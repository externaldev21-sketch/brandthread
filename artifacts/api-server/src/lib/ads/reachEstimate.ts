/**
 * Budget-true reach estimate for paid ad campaigns (pure; no database).
 *
 * The estimate is driven by the TOTAL budget (daily budget × days), not the
 * daily figure, so $130/day for 25 days reaches far more people than
 * $130/day for 2 days:
 *
 *   impressions  = totalBudget / effectiveCPM × 1000
 *   pool(days)   = audience × (1 − (1 − dailyActiveShare)^days)
 *                  — the people who open the app at least once during the
 *                    flight; a longer flight sees more distinct people
 *   reach        = pool × (1 − e^(−impressions / pool))
 *                  — random exposure with repeats: diminishing returns as the
 *                    spend approaches the pool (a soft cap, never linear forever)
 *
 * The range comes from the CPM band (auction prices vary) and pool
 * uncertainty, and is reported as a range — never a precise promise.
 * The mobile app mirrors this file in services/adReach.ts so the figure
 * updates live while the seller drags the sliders; keep the two identical.
 */

/** What 1,000 delivered impressions cost the seller, in cents. Configurable per platform. */
export const DEFAULT_EFFECTIVE_CPM_CENTS = 2000;
/** Auction/price variance: the low end assumes CPM × this, the high end CPM ÷ this. */
export const CPM_BAND = 1.25;
/** The low end also assumes only this share of the reachable pool is really there. */
export const POOL_LOW_SHARE = 0.85;

/**
 * Honest floor for small-data situations (a young platform, a dev database):
 * the estimate never models fewer reachable people than this. When the
 * measured base is smaller the response says `source: "floor"` and the app
 * labels the figure a planning estimate.
 */
export const DEFAULT_AUDIENCE_FLOOR_TOTAL = 25_000;
export const DEFAULT_AUDIENCE_FLOOR_DAILY_ACTIVE = 4_000;

export type ReachAudience = {
  /** Eligible people matching the targeting (signed-up buyers, excluding the seller). */
  total: number;
  /** Of those, how many open the app on a typical day. */
  dailyActive: number;
  source: "measured" | "floor";
};

export type ReachModel = {
  cpmCents: number;
  audience: ReachAudience;
};

export type ReachEstimate = {
  low: number;
  high: number;
  /** Expected delivered impressions for the spend at the platform CPM. */
  impressions: number;
  /** People who will open the app during the flight (upper bound on reach). */
  reachablePool: number;
  /** 0..1 — how close the spend is to saturating the reachable pool. */
  saturation: number;
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Platform constants, overridable via env (AD_EFFECTIVE_CPM_CENTS, AD_AUDIENCE_FLOOR_TOTAL, AD_AUDIENCE_FLOOR_DAILY_ACTIVE). */
export function reachConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    cpmCents: positiveInt(env.AD_EFFECTIVE_CPM_CENTS, DEFAULT_EFFECTIVE_CPM_CENTS),
    floorTotal: positiveInt(env.AD_AUDIENCE_FLOOR_TOTAL, DEFAULT_AUDIENCE_FLOOR_TOTAL),
    floorDailyActive: positiveInt(env.AD_AUDIENCE_FLOOR_DAILY_ACTIVE, DEFAULT_AUDIENCE_FLOOR_DAILY_ACTIVE),
  };
}

/** Applies the honest floor to a measured audience. */
export function resolveAudience(
  measured: { total: number; dailyActive: number },
  floor: { total: number; dailyActive: number },
): ReachAudience {
  if (measured.total >= floor.total) {
    // Real base is big enough; still never model a dead app (≥1 daily active).
    return { total: measured.total, dailyActive: Math.max(1, Math.min(measured.total, measured.dailyActive)), source: "measured" };
  }
  return { total: floor.total, dailyActive: Math.min(floor.total, floor.dailyActive), source: "floor" };
}

/** People who open the app at least once over `days` days. */
export function reachablePool(audience: Pick<ReachAudience, "total" | "dailyActive">, days: number): number {
  if (audience.total <= 0) return 0;
  const share = Math.min(1, Math.max(0, audience.dailyActive / audience.total));
  return audience.total * (1 - Math.pow(1 - share, Math.max(1, days)));
}

/** Expected distinct people reached by `impressions` spread at random over `pool` people. */
export function expectedReach(impressions: number, pool: number): number {
  if (pool <= 0 || impressions <= 0) return 0;
  return pool * (1 - Math.exp(-impressions / pool));
}

export function estimateCampaignReach(input: {
  totalBudgetCents: number;
  durationDays: number;
  model: ReachModel;
}): ReachEstimate {
  const { totalBudgetCents, durationDays, model } = input;
  const cpm = Math.max(1, model.cpmCents);
  const impressions = (Math.max(0, totalBudgetCents) / cpm) * 1000;
  const pool = reachablePool(model.audience, durationDays);
  const lowImpressions = impressions / CPM_BAND;
  const highImpressions = impressions * CPM_BAND;
  const low = expectedReach(lowImpressions, pool * POOL_LOW_SHARE);
  const high = expectedReach(highImpressions, pool);
  return {
    low: Math.floor(low),
    high: Math.max(Math.floor(low), Math.floor(high)),
    impressions: Math.round(impressions),
    reachablePool: Math.round(pool),
    saturation: pool > 0 ? Math.min(1, expectedReach(impressions, pool) / pool) : 0,
  };
}
