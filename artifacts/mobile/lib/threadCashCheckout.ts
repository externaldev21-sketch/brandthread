/**
 * Thread Cash at checkout (item 109): the pure rules the toggle follows.
 * Every number here mirrors a server rule, and the server stays
 * authoritative:
 *
 *  - It is a discount on a card purchase, never the whole payment. The card
 *    must still be charged at least Stripe's minimum (50¢). This is
 *    STRIPE_MIN_CARD_CHARGE_CENTS in routes/buyer.ts, enforced by
 *    reserveThreadCashRedemption.
 *  - It stacks after the seller's promo code and loyalty rewards. The server
 *    checks the token against (subtotal + shipping − promo − loyalty) − 50¢
 *    (routes/buyer.ts, "Thread Cash reservation").
 *  - Tax isn't part of that ceiling. Stripe computes it on the discounted
 *    amount.
 *  - An admin-set per-order cap (thread_cash_config.max_redemption_per_order_cents)
 *    applies on top. redeemThreadCash rejects anything above it.
 *  - Single-seller orders only. Checkout sends the token only when there is
 *    one delivery group, because a token discounts exactly one Stripe
 *    session.
 */
export const STRIPE_MIN_CARD_CHARGE_CENTS = 50;

/** The most Thread Cash this order can take, before balance and cap. */
export function threadCashCeilingCents(input: {
  subtotalCents: number;
  shippingCents: number;
  promoCents?: number;
  loyaltyCents?: number;
}): number {
  const remaining = input.subtotalCents + input.shippingCents - (input.promoCents ?? 0) - (input.loyaltyCents ?? 0);
  return Math.max(0, remaining - STRIPE_MIN_CARD_CHARGE_CENTS);
}

/**
 * What turning the toggle on applies. The owner's spec is "Use Thread Cash −$X",
 * an on/off toggle that applies all it can.
 * `availableCents` = spendable balance + whatever this checkout already holds.
 */
export function threadCashTargetCents(input: {
  availableCents: number;
  ceilingCents: number;
  perOrderCapCents?: number | null;
}): number {
  return Math.max(0, Math.min(
    input.availableCents,
    input.ceilingCents,
    input.perOrderCapCents ?? Number.POSITIVE_INFINITY,
  ));
}

/** Why the toggle can't be used right now, or null when it can. */
export function threadCashUnavailableReason(input: { availableCents: number; ceilingCents: number }): 'no_balance' | 'order_too_small' | null {
  if (input.availableCents < 1) return 'no_balance';
  if (input.ceilingCents < 1) return 'order_too_small';
  return null;
}

/** Leftover redemptions to return to the balance: every open one except the one this checkout holds. */
export function staleRedemptionTokens(open: { token: string }[] | undefined, keepToken: string | null | undefined): string[] {
  const keep = keepToken?.trim().toUpperCase();
  return (open ?? []).map(r => r.token).filter(token => token.toUpperCase() !== keep);
}
