/**
 * Seller payout gate: a product may only go live (status → "active") once the
 * store owner's Stripe Connect account exists and Stripe has enabled both
 * charges and payouts. Readiness uses the same cached `stripe_account_status`
 * the checkout routes already require ("active" is written by
 * GET /api/seller/connect/status and the account.updated webhook only when
 * charges_enabled && payouts_enabled), so a listing can never be buyable
 * while checkout would refuse the seller.
 *
 * Products that were already live before this gate are left alone — only the
 * transition into "active" is refused.
 */
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

export const PAYOUTS_NOT_READY = "PAYOUTS_NOT_READY";

export type PayoutReadiness = {
  ready: boolean;
  /** "not_started" when no Connect account exists, else the cached Stripe status. */
  status: "not_started" | "pending" | "restricted" | "active";
};

export function payoutReadinessFrom(row: { stripeAccountId: string | null; stripeAccountStatus: string | null } | undefined): PayoutReadiness {
  if (!row?.stripeAccountId) return { ready: false, status: "not_started" };
  const status = row.stripeAccountStatus === "active" || row.stripeAccountStatus === "restricted"
    ? row.stripeAccountStatus
    : "pending";
  return { ready: status === "active", status };
}

export async function getSellerPayoutReadiness(ownerClerkId: string): Promise<PayoutReadiness> {
  const [row] = await db
    .select({ stripeAccountId: users.stripeAccountId, stripeAccountStatus: users.stripeAccountStatus })
    .from(users)
    .where(eq(users.clerkId, ownerClerkId))
    .limit(1);
  return payoutReadinessFrom(row);
}

export function payoutsNotReadyBody(readiness: PayoutReadiness) {
  return {
    error: readiness.status === "not_started"
      ? "Set up payouts before publishing. Your listing can be saved as a draft until then."
      : "Finish payout setup before publishing. Your listing can be saved as a draft until then.",
    code: PAYOUTS_NOT_READY,
    payoutStatus: readiness.status,
  };
}
