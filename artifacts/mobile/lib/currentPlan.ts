/**
 * What the seller's current platform plan is, for every screen that shows it
 * (Subscription, Finance). Brandthread has no free plan: a seller without a
 * subscription has *no* plan, so nothing may call them "Starter" or "Free" or
 * show a $29/mo price they are not paying (QA-0093, QA-0166).
 */
import { formatCents } from '@/lib/money';
import { getSellerPlan } from '@/lib/sellerPlans';
import type { SubscriptionBillingProvider } from '@/lib/subscriptionRecovery';

/** Statuses that mean the seller holds (or is finishing) a paid plan. */
const SUBSCRIBED = new Set(['active', 'trialing', 'past_due', 'unpaid', 'canceled']);

export function hasSellerSubscription(status: string | null | undefined): boolean {
  return !!status && SUBSCRIBED.has(status);
}

export type CurrentPlanSummary = {
  hasPlan: boolean;
  /** Plan id when subscribed, otherwise null (no plan card is "current"). */
  planId: string | null;
  name: string;
  /** "$29/mo" from the real charge (or the plan's list price); null without a plan. */
  priceLabel: string | null;
  statusLabel: string;
};

export function currentPlanSummary(input: {
  plan: string | null | undefined;
  status: string | null | undefined;
  amountCents: number | null | undefined;
}): CurrentPlanSummary {
  const plan = getSellerPlan(input.plan);
  if (!hasSellerSubscription(input.status) || !plan) {
    return { hasPlan: false, planId: null, name: 'No plan', priceLabel: null, statusLabel: 'Not subscribed' };
  }
  const price = input.amountCents && input.amountCents > 0 ? formatCents(input.amountCents) : plan.priceLabel;
  const statusLabel =
    input.status === 'active' ? 'Active'
    : input.status === 'trialing' ? 'Trial'
    : input.status === 'canceled' ? 'Cancelled'
    : 'Past due';
  return { hasPlan: true, planId: plan.id, name: plan.name, priceLabel: `${price}/mo`, statusLabel };
}

/** The store's own subscription page (App Store / Google Play). */
export function storeSubscriptionsUrl(os: string): string | null {
  if (os === 'ios') return 'https://apps.apple.com/account/subscriptions';
  if (os === 'android') return 'https://play.google.com/store/account/subscriptions';
  return null;
}

export type ManageSubscriptionAction =
  | { kind: 'open_url'; url: string }
  | { kind: 'stripe_portal' }
  /** Billed on the web (Stripe): native apps may not link to it (App Store 3.1.1 / 3.1.3). */
  | { kind: 'web_billed' }
  /** Web, but the plan is billed by Apple / Google: only the store can change it. */
  | { kind: 'store_billed' }
  | { kind: 'no_subscription' };

/**
 * Where "Manage subscription" goes (QA-0167). Native never opens the Stripe
 * portal — it is an external purchase flow (plan changes, cards). Store
 * subscriptions open the store's page; web-billed plans get a plain notice.
 */
export function manageSubscriptionAction(
  os: string,
  provider: SubscriptionBillingProvider,
  revenueCatManagementURL: string | null | undefined,
): ManageSubscriptionAction {
  if (os === 'web') {
    if (provider === 'stripe') return { kind: 'stripe_portal' };
    return provider === 'revenuecat' ? { kind: 'store_billed' } : { kind: 'no_subscription' };
  }
  if (provider === 'stripe') return { kind: 'web_billed' };
  const url = revenueCatManagementURL || storeSubscriptionsUrl(os);
  return url ? { kind: 'open_url', url } : { kind: 'web_billed' };
}

export const WEB_BILLED_NOTICE = 'Your plan is billed on the web. Manage it at brandthread.app.';
export const STORE_BILLED_NOTICE = 'Your plan is billed through the App Store or Google Play. Manage it on your phone.';
