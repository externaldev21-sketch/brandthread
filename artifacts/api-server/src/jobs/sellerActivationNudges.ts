/**
 * Hourly seller activation nudges (rules in lib/sellerLifecycle/nudges.ts):
 * unfinished onboarding, no product, no payouts, store not published. Each
 * message is claimed in seller_lifecycle_messages before it is sent, so it
 * goes out once even when several API instances run this job. Push goes
 * through publishNotification (Activity + push, the seller's push settings
 * apply); email honours the `seller_tips` switch and carries a one-click
 * "Stop these emails" link.
 */
import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { logger } from "../lib/logger";
import { sendBrandthreadEmail } from "../lib/brandthreadEmail";
import { publishNotification } from "../routes/notifications-feed";
import { claimLifecycleMessage, markLifecycleDelivered } from "../lib/sellerLifecycle/claims";
import { decideNudge } from "../lib/sellerLifecycle/nudges";
import { NUDGE_COPY, nudgeEmail } from "../lib/sellerLifecycle/emails";
import { sellerTipsEnabled, sellerTipsUnsubscribeUrl } from "../lib/sellerLifecycle/unsubscribe";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runSellerActivationNudges(now = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const candidates = await db.select({
      clerkId: users.clerkId,
      email: users.email,
      createdAt: users.createdAt,
      onboardingComplete: users.onboardingComplete,
      stripeAccountStatus: users.stripeAccountStatus,
      preferences: users.notificationPreferences,
      activeProducts: sql<number>`(SELECT count(*)::int FROM products p WHERE p.owner_id = ${users.clerkId} AND p.status = 'active' AND p.deleted_at IS NULL)`,
      storePublished: sql<boolean>`EXISTS (SELECT 1 FROM storefronts s WHERE s.owner_id = ${users.clerkId} AND s.status = 'published')`,
    }).from(users).where(and(
      or(eq(users.accountType, "seller"), eq(users.accountType, "both"), sql`${users.brandName} IS NOT NULL`),
      isNull(users.deletedAt),
      isNull(users.suspendedAt),
      lte(users.createdAt, new Date(now.getTime() - 2 * 60 * 60 * 1000)),
      gte(users.createdAt, new Date(now.getTime() - 30 * DAY_MS)),
    )).limit(BATCH);

    for (const seller of candidates) {
      const decision = decideNudge({
        createdAt: seller.createdAt,
        onboardingComplete: seller.onboardingComplete,
        activeProducts: Number(seller.activeProducts ?? 0),
        stripeActive: seller.stripeAccountStatus === "active",
        storePublished: Boolean(seller.storePublished),
      }, now);
      if (!decision) continue;
      if (!await claimLifecycleMessage(seller.clerkId, decision.claimKind, "once")) continue;
      const copy = NUDGE_COPY[decision.kind];
      let pushed = false;
      if (decision.push && sellerTipsEnabled(seller.preferences, "push")) {
        await publishNotification({
          userId: seller.clerkId,
          category: "orders",
          pushCategory: "order",
          type: `seller_nudge_${decision.kind}`,
          title: copy.title,
          body: copy.body,
          targetType: "seller_setup",
          targetId: copy.route,
          cta: copy.cta,
        }).then(() => { pushed = true; }).catch((err) => logger.warn({ err, sellerId: seller.clerkId }, "Activation nudge push failed"));
      }
      let emailed = false;
      if (seller.email && sellerTipsEnabled(seller.preferences, "email")) {
        const email = nudgeEmail(decision.kind, sellerTipsUnsubscribeUrl(seller.clerkId));
        emailed = await sendBrandthreadEmail({
          to: seller.email, subject: email.subject, html: email.html,
          idempotencyKey: `${decision.claimKind}/${seller.clerkId}`,
        });
      }
      await markLifecycleDelivered(seller.clerkId, decision.claimKind, "once", { push: pushed, email: emailed });
      sent += 1;
    }
  } catch (err) {
    logger.error({ err, job: "sellerActivationNudges" }, "Seller activation nudges failed");
  }
  return { sent };
}

export function startSellerActivationNudgesJob(): void {
  setTimeout(() => { void runSellerActivationNudges(); }, 7 * 60 * 1000);
  setInterval(() => { void runSellerActivationNudges(); }, INTERVAL_MS);
  logger.info({ job: "sellerActivationNudges", intervalMs: INTERVAL_MS }, "Seller activation nudges job scheduled");
}
