/**
 * Escrow payment helpers for the freelancer marketplace.
 *
 * Deterministic Stripe idempotency keys make the payout transfer and the
 * refund single-shot per job even under concurrent requests, retries after a
 * crash, or webhook/sync races: Stripe returns the original result for a
 * repeated key instead of moving money twice.
 */
import type Stripe from "stripe";

export function payoutIdempotencyKey(jobId: string): string {
  return `freelancer-job-payout-${jobId}`;
}

export function refundIdempotencyKey(jobId: string): string {
  return `freelancer-job-refund-${jobId}`;
}

/**
 * Refund the escrow payment for a job — exactly once.
 * Tolerates repeated calls (deterministic idempotency key) and charges that
 * were already refunded through another path. Returns the refund id, or null
 * when the charge was already refunded outside this helper.
 */
export async function refundJobPayment(
  stripe: Stripe,
  opts: { jobId: string; paymentIntentId: string; context: string },
): Promise<string | null> {
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: opts.paymentIntentId,
        reason: "requested_by_customer",
        metadata: { freelancerJobId: opts.jobId, context: opts.context },
      },
      { idempotencyKey: refundIdempotencyKey(opts.jobId) },
    );
    return refund.id;
  } catch (err: any) {
    if (
      err?.code === "charge_already_refunded" ||
      err?.raw?.code === "charge_already_refunded"
    ) {
      return null;
    }
    throw err;
  }
}
