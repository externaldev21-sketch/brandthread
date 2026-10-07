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
import type { CheckoutSession, CheckoutThreadCashRedemption } from '@/services/cartTypes';

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

/**
 * The checkout session with a new Thread Cash amount (or none), and its
 * summary re-totalled so the breakdown and "Place order · $X" update at once.
 *
 * It also starts a new payment attempt (a new idempotency key). A payment
 * the buyer opened and closed earlier holds the old amounts, and reusing its
 * key would reopen that stale Stripe session. The server expires it when the
 * token moves (lib/threadCash/checkoutRelease.ts).
 */
export function withThreadCashRedemption(
  session: CheckoutSession,
  redemption: CheckoutThreadCashRedemption | undefined,
  nextIdempotencyKey: string,
): CheckoutSession {
  const { shippingTotalCents, taxTotalCents } = session.summary;
  // Bundle savings stay in the summary; rewards apply to what is left.
  const subtotalCents = session.summary.subtotalCents - Math.max(0, session.summary.bundleSavingsCents ?? 0);
  const loyaltyCents = Math.max(0, session.loyaltyRedemption?.discountCents ?? 0);
  const threadCashCents = Math.max(0, redemption?.discountCents ?? 0);
  const discountTotalCents = Math.min(loyaltyCents + threadCashCents, subtotalCents + shippingTotalCents);
  return {
    ...session,
    threadCashRedemption: redemption,
    idempotencyKey: nextIdempotencyKey,
    summary: {
      ...session.summary,
      discountTotalCents,
      totalCents: Math.max(0, subtotalCents - discountTotalCents + shippingTotalCents + taxTotalCents),
    },
  };
}

const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type SellerPayoutLine ={ key: string; label: string; cents: number; note?: string };

/**
 * The seller's side of a Thread Cash order (order detail → Payment). Uses
 * the order row's own money fields:
 *  - `totalCents` is what the buyer's card was charged;
 *  - `discountAmountCents` is every discount on the Stripe charge, the
 *    seller's promo AND the Thread Cash;
 *  - `threadCashAppliedCents` is the Thread Cash part. Brandthread funds it
 *    and transfers it to the seller separately (checkoutTopup.ts), so it
 *    never comes out of the seller's pay;
 *  - `platformFeeCents` and `processingFeeChargedCents` are what the
 *    seller paid in fees. Both are worked out on the full price.
 * Returns null for an order without Thread Cash, or without the fields.
 */
export function sellerThreadCashPayout(raw: {
  totalCents?: number | null;
  discountAmountCents?: number | null;
  threadCashAppliedCents?: number | null;
  platformFeeCents?: number | null;
  processingFeeChargedCents?: number | null;
}): { lines: SellerPayoutLine[]; payoutCents: number } | null {
  const threadCash = Math.max(0, raw.threadCashAppliedCents ?? 0);
  if (threadCash < 1 || typeof raw.totalCents !== 'number') return null;
  const card = Math.max(0, raw.totalCents);
  const promo = Math.max(0, (raw.discountAmountCents ?? 0) - threadCash);
  const platformFee = Math.max(0, raw.platformFeeCents ?? 0);
  const processing = Math.max(0, raw.processingFeeChargedCents ?? 0);
  // Every line adds up to the payout. The promo is already out of the card
  // charge, so it's a note on that line, not a second deduction.
  const lines: SellerPayoutLine[] = [
    { key: 'card', label: 'Buyer paid by card', cents: card, ...(promo > 0 ? { note: `After your ${formatUsd(promo)} promo code` } : {}) },
    { key: 'thread_cash', label: 'Thread Cash', cents: threadCash, note: 'Paid to you by Brandthread' },
  ];
  if (platformFee > 0) lines.push({ key: 'platform_fee', label: 'Brandthread fee', cents: -platformFee });
  if (processing > 0) lines.push({ key: 'processing', label: 'Card processing', cents: -processing });
  return { lines, payoutCents: card + threadCash - platformFee - processing };
}
