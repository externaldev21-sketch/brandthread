import type Stripe from "stripe";

export type PromotionKind = "boost" | "featured_slot";

export type PromotionRefundResult =
  | { status: "refunded"; refundId: string }
  /** The charge was already refunded elsewhere, or the session took no payment. */
  | { status: "nothing_to_refund"; refundId: null };

/**
 * Refunds the full Checkout payment behind a boost / featured slot — exactly
 * once. The idempotency key is deterministic per target, so retrying a failed
 * rejection can never double refund. Throws on any Stripe failure other than
 * "already refunded" so the caller can record refund_status = 'failed'.
 */
export async function refundPromotionPayment(
  stripe: Stripe,
  opts: { kind: PromotionKind; targetId: string; checkoutSessionId: string | null; context: string },
): Promise<PromotionRefundResult> {
  if (!opts.checkoutSessionId) return { status: "nothing_to_refund", refundId: null };

  const session = await stripe.checkout.sessions.retrieve(opts.checkoutSessionId);
  const paymentIntent = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  if (!paymentIntent) return { status: "nothing_to_refund", refundId: null };

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntent,
        reason: "requested_by_customer",
        metadata: { promotionKind: opts.kind, promotionId: opts.targetId, context: opts.context },
      },
      { idempotencyKey: `promotion-refund/${opts.kind}/${opts.targetId}` },
    );
    return { status: "refunded", refundId: refund.id };
  } catch (err: any) {
    if (err?.code === "charge_already_refunded" || err?.raw?.code === "charge_already_refunded") {
      return { status: "nothing_to_refund", refundId: null };
    }
    throw err;
  }
}

/** Review gate for new boosts. On by default; only a literal "false" disables it (local dev). */
export function promotionReviewRequired(): boolean {
  return process.env.PROMOTION_REVIEW_REQUIRED !== "false";
}
