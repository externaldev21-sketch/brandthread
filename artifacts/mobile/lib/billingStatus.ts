/**
 * Failed-payment state for Settings → Subscription (item 115).
 *
 * Stripe plans: the server retries a failed payment 3 times
 * (BILLING_DUNNING_MAX_RETRIES) and pauses the plan after the last retry
 * fails; GET /api/seller/subscription/status returns `dunning`.
 * App Store / Google Play plans: Apple and Google run their own billing retry
 * (RevenueCat status "grace"); the plan can't be paused from here, so the app
 * only explains it and links to the store's payment settings.
 *
 * Layout copies Warby Parker's "Please update your payment method" card
 * (title, what happened, one full-width button).
 */
export type DunningSummary =
  | { state: 'retrying'; retryNumber: number; maxRetries: number; nextRetryAt: string | null }
  | { state: 'paused'; pausedAt: string; maxRetries: number }
  | null;

export type PaymentAlert = {
  kind: 'retrying' | 'paused' | 'failed' | 'store_retry';
  title: string;
  body: string;
  cta: string;
};

export function formatRetryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function paymentAlertFor(input: {
  status: string;
  provider: 'stripe' | 'revenuecat' | 'none';
  dunning?: DunningSummary;
  planName: string;
  platformOS: string;
}): PaymentAlert | null {
  const { dunning } = input;
  if (input.provider === 'revenuecat') {
    if (input.status !== 'grace') return null;
    const store = input.platformOS === 'android' ? 'Google Play' : 'App Store';
    return {
      kind: 'store_retry',
      title: 'Update your payment method',
      body: `The ${store} couldn't renew your ${input.planName} plan and is retrying the payment. Update your payment method in your ${store} account to keep your features.`,
      cta: 'Update payment method',
    };
  }
  if (dunning?.state === 'paused' || input.status === 'paused') {
    const tries = (dunning?.state === 'paused' ? dunning.maxRetries : 3) + 1;
    return {
      kind: 'paused',
      title: 'Your plan is paused',
      body: `Your card was declined ${tries} times, so your ${input.planName} features are paused. Update your card to pay and pick up where you left off.`,
      cta: 'Update card',
    };
  }
  if (input.status !== 'past_due' && input.status !== 'unpaid') return null;
  if (dunning?.state === 'retrying') {
    const retry = `Retry ${dunning.retryNumber} of ${dunning.maxRetries}`;
    return {
      kind: 'retrying',
      title: 'Payment failed',
      body: dunning.nextRetryAt
        ? `Your card was declined. ${retry} on ${formatRetryDate(dunning.nextRetryAt)}. Update your card to keep your features.`
        : `Your card was declined. Update your card to keep your features.`,
      cta: 'Update card',
    };
  }
  return {
    kind: 'failed',
    title: 'Payment failed',
    body: 'Your last payment didn’t go through. Update your card to keep your features.',
    cta: 'Update card',
  };
}
