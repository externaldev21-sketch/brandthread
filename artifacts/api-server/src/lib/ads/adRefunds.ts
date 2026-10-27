/**
 * Pro-rata refunds for paid ad campaigns.
 *
 * A campaign is charged its full total up front (Stripe Checkout) and billed
 * per confirmed viewable impression as it delivers. When it completes with
 * budget left over — the seller stopped it early, or the flight ended before
 * the paced budget could deliver — the undelivered remainder goes back to
 * the seller through a Stripe refund on the original PaymentIntent:
 *
 *   refund = paidAmount − spentCents − alreadyRefunded
 *
 * Exactly-once: a row is claimed (refund_status → 'processing') before the
 * Stripe call, and the call carries an idempotency key derived from the
 * campaign and how much was already refunded, so a crash or a concurrent
 * sweep can never refund twice. Failures are left as 'failed' and retried by
 * the lifecycle sweep (jobs/adCampaignLifecycle.ts), as is a claim left
 * 'processing' by a crash (the idempotency key makes the retry safe).
 *
 * Store-rail purchases (App Store / Play) can't be partially refunded by us;
 * they are never touched here.
 */
import type Stripe from "stripe";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { adCampaigns, db } from "@workspace/db";

export type RefundOutcome =
  | { status: "refunded"; amountCents: number; refundStatus: "succeeded" | "pending" }
  | { status: "nothing_to_refund" }
  | { status: "not_refundable"; reason: "not_completed" | "store_rail" | "not_found" | "in_progress" | "already_refunded" }
  | { status: "failed"; error: string };

/** What is still owed back to the seller, in cents (never negative). */
export function undeliveredRemainderCents(c: {
  paidAmountCents: number | null;
  budgetCents: number;
  spentCents: number;
  refundedCents: number;
}): number {
  const paid = c.paidAmountCents ?? c.budgetCents;
  return Math.max(0, paid - c.spentCents - c.refundedCents);
}

type StripeRefunds = Pick<Stripe, "refunds" | "checkout">;

/** A 'processing' claim older than this is assumed abandoned (crash) and may be retried. */
const STALE_CLAIM_MS = 15 * 60 * 1000;

function claimable(now: Date) {
  return or(
    isNull(adCampaigns.refundStatus),
    eq(adCampaigns.refundStatus, "failed"),
    and(eq(adCampaigns.refundStatus, "processing"), lt(adCampaigns.updatedAt, new Date(now.getTime() - STALE_CLAIM_MS))),
  );
}

async function paymentIntentFor(stripe: StripeRefunds, row: typeof adCampaigns.$inferSelect): Promise<string | null> {
  if (row.stripePaymentIntentId) return row.stripePaymentIntentId;
  if (!row.stripeCheckoutSessionId) return null;
  const session = await stripe.checkout.sessions.retrieve(row.stripeCheckoutSessionId);
  const pi = session.payment_intent;
  return typeof pi === "string" ? pi : pi?.id ?? null;
}

/**
 * Refunds the undelivered remainder of one completed, Stripe-paid campaign.
 * Safe to call repeatedly and concurrently.
 */
export async function refundUndeliveredAdBudget(
  campaignId: string,
  stripe: StripeRefunds,
  now: Date = new Date(),
): Promise<RefundOutcome> {
  const [claimed] = await db.update(adCampaigns)
    .set({ refundStatus: "processing", updatedAt: now })
    .where(and(
      eq(adCampaigns.id, campaignId),
      eq(adCampaigns.status, "completed"),
      eq(adCampaigns.paymentRail, "stripe"),
      claimable(now),
    ))
    .returning();

  if (!claimed) {
    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaignId)).limit(1);
    if (!row) return { status: "not_refundable", reason: "not_found" };
    if (row.status !== "completed") return { status: "not_refundable", reason: "not_completed" };
    if (row.paymentRail !== "stripe") return { status: "not_refundable", reason: "store_rail" };
    if (row.refundStatus === "processing") return { status: "not_refundable", reason: "in_progress" };
    return { status: "not_refundable", reason: "already_refunded" };
  }

  const amount = undeliveredRemainderCents(claimed);
  if (amount <= 0) {
    await db.update(adCampaigns).set({ refundStatus: "succeeded", updatedAt: now }).where(eq(adCampaigns.id, campaignId));
    return { status: "nothing_to_refund" };
  }

  try {
    const paymentIntent = await paymentIntentFor(stripe, claimed);
    if (!paymentIntent) throw new Error("No PaymentIntent recorded for this campaign");
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntent,
        amount,
        reason: "requested_by_customer",
        metadata: { kind: "ad_campaign_refund", adCampaignId: campaignId, sellerId: claimed.sellerId },
      },
      { idempotencyKey: `ad-campaign-refund/${campaignId}/${claimed.refundedCents}` },
    );
    if (refund.status === "failed" || refund.status === "canceled") {
      throw new Error(`Stripe refund ${refund.id} ${refund.status}`);
    }
    const refundStatus = refund.status === "succeeded" ? "succeeded" : "pending";
    await db.update(adCampaigns).set({
      refundedCents: sql`${adCampaigns.refundedCents} + ${amount}`,
      refundStatus,
      stripeRefundId: refund.id,
      stripePaymentIntentId: paymentIntent,
      refundedAt: now,
      updatedAt: now,
    }).where(eq(adCampaigns.id, campaignId));
    return { status: "refunded", amountCents: amount, refundStatus };
  } catch (err) {
    await db.update(adCampaigns).set({ refundStatus: "failed", updatedAt: now }).where(eq(adCampaigns.id, campaignId));
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sweeps completed Stripe-paid campaigns that still owe a refund (new or previously failed). */
export async function refundCompletedAdCampaigns(stripe: StripeRefunds, now: Date = new Date(), limit = 50): Promise<RefundOutcome[]> {
  const rows = await db.select({ id: adCampaigns.id })
    .from(adCampaigns)
    .where(and(
      eq(adCampaigns.status, "completed"),
      eq(adCampaigns.paymentRail, "stripe"),
      claimable(now),
      sql`coalesce(${adCampaigns.paidAmountCents}, ${adCampaigns.budgetCents}) - ${adCampaigns.spentCents} - ${adCampaigns.refundedCents} > 0`,
    ))
    .limit(limit);
  const outcomes: RefundOutcome[] = [];
  for (const r of rows) outcomes.push(await refundUndeliveredAdBudget(r.id, stripe, now));
  return outcomes;
}
