/**
 * Pure helpers for Brandthread Pro perks. The numbers (commission, monthly AI
 * credits, advanced analytics, price) come from the server
 * (GET /api/seller/subscription/perks) so nothing here hardcodes a rate.
 */

export type PlanPerk = {
  planId: 'starter' | 'growth' | 'pro';
  name: string;
  amountCents: number;
  platformFeeBps: number;
  /** null when unlimited. */
  monthlyAiCredits: number | null;
  unlimitedAiCredits: boolean;
  advancedAnalytics: boolean;
};

export type PerksResponse = {
  plans: PlanPerk[];
  currentPlan: string | null;
  hasAdvancedAnalytics: boolean;
};

/** 300 -> "3%", 350 -> "3.5%", 500 -> "5%". */
export function formatFeeRate(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')}%`;
}

/**
 * "5% on every plan" when the server reports one rate for all plans (the
 * owner's rule), otherwise "5% Starter · 4% Growth · 3% Pro"; null until
 * perks have loaded.
 */
export function commissionSummary(perks: PerksResponse | null | undefined): string | null {
  if (!perks || perks.plans.length === 0) return null;
  const rates = new Set(perks.plans.map((p) => p.platformFeeBps));
  if (rates.size === 1) return `${formatFeeRate(perks.plans[0].platformFeeBps)} on every plan`;
  return perks.plans
    .map((p) => `${formatFeeRate(p.platformFeeBps)} ${p.name.replace(/^Brandthread\s+/, '').replace(/\s+Plan$/, '')}`)
    .join(' · ');
}

export function findPlanPerk(perks: PerksResponse | null | undefined, planId: string): PlanPerk | null {
  return perks?.plans.find((p) => p.planId === planId) ?? null;
}

/** Where every locked Pro surface sends the seller: the existing plans screen, Pro preselected. */
export function proUpgradeHref(source: string): string {
  return `/plans?highlight=pro&source=${encodeURIComponent(source)}`;
}

/** Whether `highlight` asks the plans screen to preselect Pro. */
export function wantsProHighlight(highlight: string | string[] | undefined): boolean {
  return (Array.isArray(highlight) ? highlight[0] : highlight) === 'pro';
}

/** "Jan", "Feb"... from a "YYYY-MM" key. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

/** Sample values for the `&demo=1` web preview only; real sessions read the server. */
export const DEMO_PERKS: PerksResponse = {
  currentPlan: 'starter',
  hasAdvancedAnalytics: false,
  plans: [
    { planId: 'starter', name: 'Brandthread Starter Plan', amountCents: 2900, platformFeeBps: 500, monthlyAiCredits: 1000, unlimitedAiCredits: false, advancedAnalytics: false },
    { planId: 'growth', name: 'Brandthread Growth Plan', amountCents: 7900, platformFeeBps: 500, monthlyAiCredits: 4000, unlimitedAiCredits: false, advancedAnalytics: false },
    { planId: 'pro', name: 'Brandthread Pro Plan', amountCents: 19900, platformFeeBps: 500, monthlyAiCredits: null, unlimitedAiCredits: true, advancedAnalytics: true },
  ],
};

/** "Unlimited AI credits" or "1,000 AI credits per month"; never a count for unlimited plans. */
export function aiCreditsLabel(perk: PlanPerk): string {
  return perk.unlimitedAiCredits || perk.monthlyAiCredits === null
    ? 'Unlimited AI credits'
    : `${perk.monthlyAiCredits.toLocaleString('en-US')} AI credits per month`;
}
