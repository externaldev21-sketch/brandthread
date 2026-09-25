/**
 * Display-only helpers for the premium plan picker (app/plans.tsx).
 *
 * IMPORTANT — money safety: every price shown here is derived from the real
 * `SELLER_PLANS` catalogue in `lib/sellerPlans.ts` (the actual billed
 * monthly price). Nothing in this file changes what a seller is charged.
 * There is no yearly billing option today, so only the real monthly price
 * is ever shown — an annual price/toggle was deliberately left out to avoid
 * displaying a number checkout can't actually charge. See the PR
 * description for the real annual Price IDs the owner would need to create
 * before annual billing could ever be offered for real.
 */
import { SELLER_PLANS, type SellerPlanDefinition } from './sellerPlans';

export function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** The price + period copy to show on a plan card — always the real monthly price. */
export function displayPriceFor(plan: SellerPlanDefinition): {
  price: string;
  period: string;
  note: string | null;
} {
  return { price: plan.priceLabel, period: '/mo', note: null };
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
    answer: 'Plans are billed monthly today. Annual billing isn\'t available yet — we\'ll announce it here once it is.',
  },
];
