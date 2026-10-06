/**
 * What account deletion does to a seller's platform subscription (QA-0073).
 *
 * - Stripe (web-billed): scheduling deletion stops renewal
 *   (cancel_at_period_end, tagged so a restore can undo exactly that), and the
 *   purge cancels the subscription outright. A purged account is never
 *   charged again.
 * - App Store / Google Play (RevenueCat): only the person can cancel a store
 *   subscription (Apple / Google give developers no cancel API), so the
 *   deletion screen warns and links to the store's subscription page before
 *   they confirm (App Store 3.1.2 / 5.1.1(v)).
 */
import type Stripe from "stripe";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, sellerSubscriptionEntitlements, users } from "@workspace/db";
import { stripe as defaultStripe } from "./stripe";

/** Metadata flag: renewal was stopped by an account deletion, not by the person. */
export const DELETION_CANCEL_FLAG = "brandthread_account_deletion";

const LIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);
const LIVE_STORE_STATUSES = ["active", "trial", "grace"];

export type DeletionSubscription =
  | { provider: "stripe"; subscriptionId: string }
  | { provider: "store" }
  | null;

/** Pure: which subscription (if any) deletion has to deal with. Store wins: it is the one we cannot stop. */
export function classifyDeletionSubscription(input: {
  stripeSubscriptionId: string | null | undefined;
  stripeStatus: string | null | undefined;
  hasLiveStoreEntitlement: boolean;
}): DeletionSubscription {
  if (input.hasLiveStoreEntitlement) return { provider: "store" };
  if (input.stripeSubscriptionId && (!input.stripeStatus || LIVE_STRIPE_STATUSES.has(input.stripeStatus))) {
    return { provider: "stripe", subscriptionId: input.stripeSubscriptionId };
  }
  return null;
}

export async function getDeletionSubscription(clerkUserId: string): Promise<DeletionSubscription> {
  const [[user], [store]] = await Promise.all([
    db.select({ subscriptionId: users.subscriptionId, status: users.subscriptionStatus })
      .from(users).where(eq(users.clerkId, clerkUserId)).limit(1),
    db.select({ id: sellerSubscriptionEntitlements.id }).from(sellerSubscriptionEntitlements)
      .where(and(
        eq(sellerSubscriptionEntitlements.clerkUserId, clerkUserId),
        eq(sellerSubscriptionEntitlements.provider, "revenuecat"),
        inArray(sellerSubscriptionEntitlements.status, LIVE_STORE_STATUSES),
      ))
      .orderBy(desc(sellerSubscriptionEntitlements.lastSyncedAt)).limit(1),
  ]);
  return classifyDeletionSubscription({
    stripeSubscriptionId: user?.subscriptionId,
    stripeStatus: user?.status,
    hasLiveStoreEntitlement: !!store,
  });
}

/** What the deletion screen lists for the subscription, server-worded. */
export function deletionSubscriptionCopy(sub: DeletionSubscription): {
  willDelete: string[];
  notice: { provider: "store"; title: string; detail: string } | null;
} {
  if (sub?.provider === "stripe") {
    return { willDelete: ["Your Brandthread plan. It stops renewing now, with no further charges"], notice: null };
  }
  if (sub?.provider === "store") {
    return {
      willDelete: [],
      notice: {
        provider: "store",
        title: "Cancel your plan in the App Store or Google Play",
        detail: "Your Brandthread plan is billed by Apple or Google. Deleting your account doesn't cancel it, so cancel it in your store subscriptions to stop future charges.",
      },
    };
  }
  return { willDelete: [], notice: null };
}

type StripeSubs = Pick<Stripe["subscriptions"], "retrieve" | "update" | "cancel">;

function isGone(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string } | null;
  return e?.statusCode === 404 || e?.code === "resource_missing";
}

/** Deletion scheduled: stop renewal. Throws when Stripe refuses, so the caller can stop. */
export async function stopRenewalForDeletion(
  subscriptionId: string,
  subs: StripeSubs | undefined = defaultStripe?.subscriptions,
): Promise<"stopped" | "already_ending" | "gone"> {
  if (!subs) throw new Error("Stripe is not configured");
  try {
    const sub = await subs.retrieve(subscriptionId);
    if (sub.status === "canceled" || sub.status === "incomplete_expired") return "gone";
    if (sub.cancel_at_period_end) return "already_ending";
    await subs.update(subscriptionId, { cancel_at_period_end: true, metadata: { [DELETION_CANCEL_FLAG]: "1" } });
    return "stopped";
  } catch (err) {
    if (isGone(err)) return "gone";
    throw err;
  }
}

/** Deletion cancelled by signing back in: undo only what deletion did. Never throws. */
export async function resumeRenewalAfterRestore(
  subscriptionId: string,
  subs: StripeSubs | undefined = defaultStripe?.subscriptions,
): Promise<boolean> {
  if (!subs) return false;
  try {
    const sub = await subs.retrieve(subscriptionId);
    if (sub.status === "canceled" || sub.metadata?.[DELETION_CANCEL_FLAG] !== "1") return false;
    await subs.update(subscriptionId, { cancel_at_period_end: false, metadata: { [DELETION_CANCEL_FLAG]: "" } });
    return true;
  } catch {
    return false;
  }
}

/** Purge: cancel immediately. Throws (purge retries later) unless it is already gone. */
export async function cancelSubscriptionAtPurge(
  subscriptionId: string,
  subs: StripeSubs | undefined = defaultStripe?.subscriptions,
): Promise<void> {
  if (!subs) throw new Error("Stripe is not configured");
  try {
    await subs.cancel(subscriptionId);
  } catch (err) {
    const e = err as { code?: string; message?: string } | null;
    if (isGone(err) || /already been canceled|canceled subscription/i.test(e?.message ?? "")) return;
    throw err;
  }
}
