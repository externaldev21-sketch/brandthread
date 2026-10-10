/**
 * Pure helpers for the seller Plan & billing screen (app/billing.tsx): what
 * the current plan card says, what a plan switch changes, and the cancel
 * reasons. Prices come from the server perks (falling back to the public
 * SELLER_PLANS catalogue), never from numbers written here.
 */
import { SELLER_PLANS, getSellerPlan, type SellerPlanDefinition } from './sellerPlans';
import { formatFeeRate, aiCreditsLabel, findPlanPerk, type PerksResponse, type PlanPerk } from './proPerks';
import { formatDollars } from './sellerPlansDisplay';
import type { SellerPlanId } from './sellerBilling';

export interface PlanBillingStatus {
  plan: string;
  status: string;
  trialEnd: string | null;
  renewsOn: string | null;
  amountCents: number;
  paymentMethodLabel: string | null;
  cancelAtPeriodEnd?: boolean;
  effectiveProvider: 'stripe' | 'revenuecat' | 'none';
}

export type PlanState = 'none' | 'active' | 'trialing' | 'cancelling' | 'past_due';

const ENDED_STATUSES = new Set(['none', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'expired', '']);

export function planState(status: PlanBillingStatus | null | undefined): PlanState {
  if (!status || ENDED_STATUSES.has(status.status)) return 'none';
  if (status.status === 'past_due' || status.status === 'unpaid') return 'past_due';
  if (status.cancelAtPeriodEnd) return 'cancelling';
  if (status.status === 'trialing') return 'trialing';
  return 'active';
}

/** App Store / Google Play plans are managed in the store, never through Stripe. */
export function isNativeStorePlan(status: PlanBillingStatus | null | undefined): boolean {
  return status?.effectiveProvider === 'revenuecat';
}

/** Short badge next to the plan name. */
export function planStatusBadge(state: PlanState): string | null {
  switch (state) {
    case 'active': return 'Active';
    case 'trialing': return 'Trial';
    case 'cancelling': return 'Cancelling';
    case 'past_due': return 'Payment failed';
    default: return null;
  }
}

/** The date line under the price: "Renews on …", "Trial ends …", "Cancels on …". */
export function planDateLine(status: PlanBillingStatus, state: PlanState = planState(status)): string | null {
  if (state === 'cancelling') return status.renewsOn ? `Cancels on ${status.renewsOn}` : null;
  if (state === 'trialing') return status.trialEnd ? `Trial ends ${status.trialEnd}` : null;
  if (state === 'active' || state === 'past_due') return status.renewsOn ? `Renews on ${status.renewsOn}` : null;
  return null;
}

export function planPriceCents(planId: string, perks: PerksResponse | null | undefined): number {
  return findPlanPerk(perks, planId)?.amountCents ?? getSellerPlan(planId)?.priceCents ?? 0;
}

export function planPriceLabel(planId: string, perks: PerksResponse | null | undefined): string {
  return formatDollars(planPriceCents(planId, perks));
}

/** "Unlimited", "25", or `zeroLabel` for 0. Unknown (older server) → null. */
export function formatPlanLimit(value: number | null | undefined, zeroLabel = 'None'): string | null {
  if (value === undefined) return null;
  if (value === null) return 'Unlimited';
  if (value === 0) return zeroLabel;
  return value.toLocaleString('en-US');
}

export interface PlanFact {
  label: string;
  value: string;
}

/** The facts box on the current plan card (Shopify's "Card rates" box). */
export function planFacts(perk: PlanPerk | null): PlanFact[] {
  if (!perk) return [];
  const facts: PlanFact[] = [
    { label: 'Commission', value: `${formatFeeRate(perk.platformFeeBps)} per sale` },
    { label: 'AI credits', value: perk.unlimitedAiCredits || perk.monthlyAiCredits === null ? 'Unlimited' : `${perk.monthlyAiCredits.toLocaleString('en-US')} per month` },
  ];
  const products = formatPlanLimit(perk.productLimit);
  if (products) facts.push({ label: 'Products', value: products });
  const seats = formatPlanLimit(perk.teamSeats);
  if (seats) facts.push({ label: 'Team seats', value: seats });
  return facts;
}

export type PlanDirection = 'upgrade' | 'downgrade' | 'same';

function rank(planId: string): number {
  const id = getSellerPlan(planId)?.id;
  return SELLER_PLANS.findIndex((p) => p.id === id);
}

export function planDirection(fromId: string, toId: string): PlanDirection {
  const from = rank(fromId);
  const to = rank(toId);
  if (from === to) return 'same';
  return to > from ? 'upgrade' : 'downgrade';
}

export interface PlanChangeRow {
  label: string;
  from: string;
  to: string;
}

/** Only what actually changes between two plans. */
export function planChangeRows(fromId: string, toId: string, perks: PerksResponse | null | undefined): PlanChangeRow[] {
  const rows: PlanChangeRow[] = [];
  const push = (label: string, from: string | null, to: string | null) => {
    if (from !== null && to !== null && from !== to) rows.push({ label, from, to });
  };
  push('Price', `${planPriceLabel(fromId, perks)}/mo`, `${planPriceLabel(toId, perks)}/mo`);
  const from = findPlanPerk(perks, fromId);
  const to = findPlanPerk(perks, toId);
  if (from && to) {
    push('Commission', formatFeeRate(from.platformFeeBps), formatFeeRate(to.platformFeeBps));
    push('AI credits', aiCreditsShort(from), aiCreditsShort(to));
    push('Products', formatPlanLimit(from.productLimit), formatPlanLimit(to.productLimit));
    push('Team seats', formatPlanLimit(from.teamSeats), formatPlanLimit(to.teamSeats));
  }
  return rows;
}

function aiCreditsShort(perk: PlanPerk): string {
  return aiCreditsLabel(perk) === 'Unlimited AI credits'
    ? 'Unlimited'
    : `${(perk.monthlyAiCredits ?? 0).toLocaleString('en-US')}/mo`;
}

const EVERYTHING_IN = /^Everything in [A-Za-z]+/i;

/**
 * Tools a downgrade gives up: every feature added by the tiers above the
 * target, up to and including the current one. Empty for upgrades.
 */
export function lostFeatures(fromId: string, toId: string, plans: SellerPlanDefinition[] = SELLER_PLANS): string[] {
  const from = rank(fromId);
  const to = rank(toId);
  if (from <= to || to < 0) return [];
  return plans
    .slice(to + 1, from + 1)
    .flatMap((plan) => plan.features.filter((feature) => !EVERYTHING_IN.test(feature)));
}

/** Downgrade warning about the lower plan's product cap, or null when it has none. */
export function productCapWarning(fromId: string, toId: string, perks: PerksResponse | null | undefined): string | null {
  const from = findPlanPerk(perks, fromId);
  const to = findPlanPerk(perks, toId);
  const cap = to?.productLimit;
  if (cap === undefined || cap === null) return null;
  const fromCap = from?.productLimit;
  if (fromCap !== null && fromCap !== undefined && fromCap <= cap) return null;
  const name = getSellerPlan(toId)?.name ?? 'This plan';
  return `${name} allows up to ${cap.toLocaleString('en-US')} live products. If you have more, you can't add new ones until you're under the limit.`;
}

/** How the switch is billed, matching Stripe's prorated in-place update. */
export function prorationNote(direction: PlanDirection, state: PlanState, toId: string, perks: PerksResponse | null | undefined): string {
  const name = getSellerPlan(toId)?.name ?? 'The new plan';
  const price = planPriceLabel(toId, perks);
  if (state === 'trialing') return `Your trial continues. ${name} is billed at ${price}/month when it ends.`;
  if (direction === 'downgrade') return `Unused time on your current plan is credited to your next bill. ${name} is ${price}/month after that.`;
  return `You're charged the difference for the rest of this billing period on your next bill. ${name} is ${price}/month after that.`;
}

/** Same ids as the server's cancelReasons.ts (mapped to Stripe cancellation feedback). */
export const CANCEL_REASONS: { id: string; label: string }[] = [
  { id: 'just_testing', label: 'I was just testing Brandthread' },
  { id: 'not_enough_sales', label: "I'm not making enough sales" },
  { id: 'closing_business', label: "I'm closing the business behind this store" },
  { id: 'switching_platform', label: "I'm switching to another platform" },
  { id: 'too_expensive', label: "I'm finding Brandthread too expensive" },
  { id: 'missing_features', label: "Brandthread is missing tools I need" },
  { id: 'hard_to_set_up', label: "I'm struggling to get my store set up" },
  { id: 'other', label: 'Something else' },
];

export const CANCEL_COMMENT_MAX = 1000;

/** The next plan down, offered as an alternative in the cancel sheet. */
export function lowerPlanId(planId: string): SellerPlanId | null {
  const index = rank(planId);
  return index > 0 ? SELLER_PLANS[index - 1].id : null;
}
