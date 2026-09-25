/**
 * Display-only helpers for the premium plan picker (app/plans.tsx).
 *
 * IMPORTANT — money safety: every price shown here is derived from the real
 * `SELLER_PLANS` catalogue in `lib/sellerPlans.ts` (the actual billed
 * monthly price). Nothing in this file changes what a seller is charged —
 * "yearly" is a display-only projection (2 months free, a common SaaS
 * framing) used purely for marketing copy on the toggle. The actual
 * purchase/checkout call in plans.tsx always charges the real monthly price;
 * see the PR description for the real annual Price IDs the owner would need
 * to create before annual billing could ever be wired up for real.
 */
import { SELLER_PLANS, type SellerPlanDefinition } from './sellerPlans';

export type BillingInterval = 'monthly' | 'yearly';

/** Months of savings marketed on the yearly toggle (2 months free = ~17%). */
export const YEARLY_FREE_MONTHS = 2;

export function yearlyPriceCents(monthlyPriceCents: number): number {
  return monthlyPriceCents * (12 - YEARLY_FREE_MONTHS);
}

export function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** The price + period copy to show on a plan card for the selected interval. */
export function displayPriceFor(plan: SellerPlanDefinition, interval: BillingInterval): {
  price: string;
  period: string;
  note: string | null;
} {
  if (interval === 'monthly') {
    return { price: plan.priceLabel, period: '/mo', note: null };
  }
  const yearly = yearlyPriceCents(plan.priceCents);
  return {
    price: formatDollars(yearly),
    period: '/yr',
    note: `${formatDollars(yearly / 12)}/mo billed annually — ${YEARLY_FREE_MONTHS} months free`,
  };
}

/** Every distinct feature across all tiers, in first-appearance order, for the comparison table. */
export function comparisonRows(plans: SellerPlanDefinition[] = SELLER_PLANS): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const plan of plans) {
    for (const feature of plan.features) {
      const key = feature.replace(/^Everything in [A-Za-z]+,?\s*/i, '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(key);
    }
  }
  return rows;
}

/**
 * Whether `plan` includes `feature`, accounting for "Everything in X" carry-
 * forward: a higher tier inherits every feature explicitly listed by any
 * tier at or below it (SELLER_PLANS is defined in ascending tier order).
 */
export function planIncludesFeature(
  plan: SellerPlanDefinition,
  feature: string,
  plans: SellerPlanDefinition[] = SELLER_PLANS,
): boolean {
  const tierIndex = plans.findIndex((p) => p.id === plan.id);
  if (tierIndex === -1) return false;
  for (let i = 0; i <= tierIndex; i++) {
    if (plans[i].features.some((f) => f.replace(/^Everything in [A-Za-z]+,?\s*/i, '').trim() === feature)) {
      return true;
    }
  }
  return false;
}

export interface PlanFaqItem {
  question: string;
  answer: string;
}

export const PLAN_FAQ: PlanFaqItem[] = [
  {
    question: 'Is there a free trial?',
    answer: 'Every plan starts with a 5-day free trial. Your card is only charged once the trial ends, and you can cancel any time before then at no cost.',
  },
  {
    question: 'Does Brandthread take a commission on sales?',
    answer: 'Yes — all plans carry a platform commission on each sale, on top of the monthly subscription. Higher tiers unlock more tools, not a lower commission.',
  },
  {
    question: 'Can I change plans later?',
    answer: 'Yes. Upgrade or downgrade any time from Settings → Subscription — changes take effect immediately and billing is prorated automatically by Stripe.',
  },
  {
    question: 'What happens to my store if I cancel?',
    answer: 'Your storefront stays live through the end of your current billing period. After that, seller tools are paused until you resubscribe — your products and orders are kept, not deleted.',
  },
  {
    question: 'How do I pay — monthly or yearly?',
    answer: 'Plans are billed monthly today. Annual billing (2 months free) is shown here for planning purposes and will be available at checkout soon.',
  },
];
