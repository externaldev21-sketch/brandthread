/**
 * A buyer tried to pay a seller who has no working payouts
 * (SELLER_PAYMENTS_UNAVAILABLE at checkout). Tell the seller — Activity +
 * push, plus an email — at most once a day, with a link to Payouts.
 */
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { publishNotification } from "../../routes/notifications-feed";
import { sendBrandthreadEmail } from "../brandthreadEmail";
import { isChannelEnabled } from "../notificationChannels";
import { logger } from "../logger";
import { claimLifecycleMessage, dayKey, markLifecycleDelivered } from "./claims";
import { checkoutBlockedEmail } from "./emails";

export const CHECKOUT_BLOCKED_KIND = "checkout_blocked_no_payouts";

export async function notifySellerCheckoutBlocked(sellerId: string, now = new Date()): Promise<boolean> {
  try {
    const period = dayKey(now);
    if (!await claimLifecycleMessage(sellerId, CHECKOUT_BLOCKED_KIND, period)) return false;
    await publishNotification({
      userId: sellerId,
      category: "orders",
      pushCategory: "payout",
      type: CHECKOUT_BLOCKED_KIND,
      title: "A buyer couldn't pay you",
      body: "Someone tried to check out, but payouts aren't set up yet. Set them up so buyers can pay.",
      targetType: "payout",
      cta: "Set up payouts",
    });
    const [seller] = await db.select({ email: users.email, preferences: users.notificationPreferences })
      .from(users).where(eq(users.clerkId, sellerId)).limit(1);
    let emailed = false;
    if (seller?.email && isChannelEnabled(seller.preferences as Record<string, unknown> | null, "payout_confirmations", "email")) {
      const email = checkoutBlockedEmail();
      emailed = await sendBrandthreadEmail({ to: seller.email, subject: email.subject, html: email.html, idempotencyKey: `${CHECKOUT_BLOCKED_KIND}/${sellerId}/${period}` });
    }
    await markLifecycleDelivered(sellerId, CHECKOUT_BLOCKED_KIND, period, { push: true, email: emailed });
    return true;
  } catch (err) {
    logger.warn({ err, sellerId }, "Checkout-blocked seller alert failed");
    return false;
  }
}
