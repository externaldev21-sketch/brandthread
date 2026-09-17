/**
 * Brandthread Boost Service
 *
 * Shared constants and helpers for the Boost flow.
 * Uses the same budget/duration/reach contract as adCampaignService.
 *
 * Reach estimate formula (mirrors server exactly):
 *   low  = floor(budgetCents / 100 * 35)   // ~35 estimated reach per $1
 *   high = floor(budgetCents / 100 * 65)   // ~65 estimated reach per $1
 *
 * This is a planning estimate — NEVER reported as delivered impressions.
 */

// ─── Budget / Duration constraints (shared with adCampaignService) ─────────────

export const BOOST_BUDGET_MIN_CENTS  = 500;      // $5
export const BOOST_BUDGET_MAX_CENTS  = 100_000;  // $1000
export const BOOST_DURATION_MIN_DAYS = 1;
export const BOOST_DURATION_MAX_DAYS = 30;

// Whole-dollar increments: $5–$50 in $5 steps, $60–$200 in $10, $225–$500 in $25, $550–$1000 in $50
export function buildBoostBudgetSteps(): number[] {
  const steps: number[] = [];
  for (let d = 5;   d <= 50;   d += 5)  steps.push(d * 100);
  for (let d = 60;  d <= 200;  d += 10) steps.push(d * 100);
  for (let d = 225; d <= 500;  d += 25) steps.push(d * 100);
  for (let d = 550; d <= 1000; d += 50) steps.push(d * 100);
  return steps;
}

export const BOOST_BUDGET_STEPS = buildBoostBudgetSteps();

/** Snap arbitrary cents to nearest valid budget step */
export function snapBoostBudget(cents: number): number {
  let best = BOOST_BUDGET_STEPS[0];
  let bestDist = Math.abs(cents - best);
  for (const s of BOOST_BUDGET_STEPS) {
    const d = Math.abs(cents - s);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}

// ─── Reach estimate (mirrors server formula exactly) ──────────────────────────

export function estimateBoostReach(budgetCents: number): { low: number; high: number } {
  const dollars = budgetCents / 100;
  return {
    low:  Math.floor(dollars * 35),
    high: Math.floor(dollars * 65),
  };
}

// ─── Checkout return URL ───────────────────────────────────────────────────────
// Matches isAllowedBrandthreadCallbackUrl(value, "boost_checkout"):
//   brandthread://boost/?id=<uuid>&paymentReturn=1   (native/Expo)
//   https://<origin>/boost?id=<uuid>&paymentReturn=1 (web)

export function buildBoostReturnUrl(boostId: string, webOrigin?: string): string {
  const params = `id=${encodeURIComponent(boostId)}&paymentReturn=1`;
  if (webOrigin) {
    return `${webOrigin}/boost?${params}`;
  }
  return `brandthread://boost/?${params}`;
}
