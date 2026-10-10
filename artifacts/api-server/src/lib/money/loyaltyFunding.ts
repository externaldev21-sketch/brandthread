/**
 * BT-066: Brandthread loyalty / referral points are platform-funded.
 *
 * Points are Brandthread's own program (100 on signup, 500 per referral, 1 per
 * $1 at any store), so — like Thread Cash — redeeming them:
 *   - discounts the buyer's Stripe charge (one combined coupon, routes/buyer.ts);
 *   - never reduces the platform-fee / processing-fee basis;
 *   - never reduces the seller's payout: Brandthread tops the seller up for
 *     exactly the redeemed amount from its own balance
 *     (lib/money/loyaltyTopup.ts, ledger account `loyalty_seller_topup`).
 * Only a seller's own discount code is seller-funded.
 *
 * Pure amount math only; no database, no Stripe.
 */

const nonNeg = (n: number | null | undefined) => Math.max(0, Math.trunc(Number(n) || 0));

/**
 * How much of Stripe's applied discount was loyalty points. Stripe's
 * amount_discount is authoritative; Thread Cash is carved out first, and the
 * loyalty share can never exceed what was reserved at checkout.
 */
export function loyaltyAppliedCents(input: {
  stripeDiscountCents: number;
  threadCashAppliedCents: number;
  loyaltyDiscountCents: number;
}): number {
  const afterThreadCash = Math.max(0, nonNeg(input.stripeDiscountCents) - nonNeg(input.threadCashAppliedCents));
  return Math.min(nonNeg(input.loyaltyDiscountCents), afterThreadCash);
}

/**
 * The seller-funded part of the discount (the seller's discount code): the
 * only discount that reduces the fee basis and the seller's share.
 */
export function sellerFundedDiscountCents(input: {
  stripeDiscountCents: number;
  threadCashAppliedCents: number;
  loyaltyAppliedCents: number;
  subtotalCents: number;
}): number {
  const remaining = nonNeg(input.stripeDiscountCents) - nonNeg(input.threadCashAppliedCents) - nonNeg(input.loyaltyAppliedCents);
  return Math.min(Math.max(0, remaining), nonNeg(input.subtotalCents));
}

/** Fee basis at checkout creation: only the seller's discount code shrinks it. */
export function checkoutFeeBasis(input: {
  subtotalCents: number;
  totalBeforeDiscountsCents: number;
  sellerDiscountCents: number;
}): { merchandiseCents: number; preTaxTotalCents: number } {
  const discount = nonNeg(input.sellerDiscountCents);
  return {
    merchandiseCents: Math.max(0, nonNeg(input.subtotalCents) - discount),
    preTaxTotalCents: Math.max(0, nonNeg(input.totalBeforeDiscountsCents) - discount),
  };
}

/**
 * Stripe rejects an application fee above the charge. With platform-funded
 * discounts the fee is computed on the full price while the charge is not, so
 * a destination charge's fee is capped at the (pre-tax) amount charged.
 * Mutates and returns the payment_intent_data fragment.
 */
export function capApplicationFee<T extends Record<string, unknown>>(paymentIntentData: T, chargeCents: number): T {
  const fee = paymentIntentData.application_fee_amount;
  if (typeof fee === "number" && fee > nonNeg(chargeCents)) {
    (paymentIntentData as Record<string, unknown>).application_fee_amount = nonNeg(chargeCents);
  }
  return paymentIntentData;
}

/**
 * Whether the seller's loyalty top-up may go out now. Destination charges
 * paid the seller at checkout, so the top-up follows right away; held and
 * transfer orders top up only once the order's own payout has left (same
 * hold-until-delivered rule as the rest of the seller's money).
 */
export function loyaltyTopupDue(order: {
  chargeModel: string | null;
  fundsState: string | null;
  status: string | null;
  loyaltyAppliedCents: number;
  stripeLoyaltyTransferId: string | null;
}): boolean {
  if (order.loyaltyAppliedCents < 1 || order.stripeLoyaltyTransferId) return false;
  if (order.status === "cancelled" || order.status === "refund_pending") return false;
  if (order.chargeModel === "destination") return order.fundsState === "settled_direct";
  if (order.chargeModel === "transfer" || order.chargeModel === "held") return order.fundsState === "released";
  return false;
}
