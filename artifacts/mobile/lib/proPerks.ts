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
  monthlyAiCredits: number;
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

/** "5% Starter · 4% Growth · 3% Pro", or null until perks have loaded. */
export function commissionSummary(perks: PerksResponse | null | undefined): string | null {
  if (!perks || perks.plans.length === 0) return null;
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
    { planId: 'starter', name: 'Brandthread Starter Plan', amountCents: 2900, platformFeeBps: 500, monthlyAiCredits: 50, advancedAnalytics: false },
    { planId: 'growth', name: 'Brandthread Growth Plan', amountCents: 7900, platformFeeBps: 400, monthlyAiCredits: 150, advancedAnalytics: false },
    { planId: 'pro', name: 'Brandthread Pro Plan', amountCents: 19900, platformFeeBps: 300, monthlyAiCredits: 600, advancedAnalytics: true },
  ],
};
