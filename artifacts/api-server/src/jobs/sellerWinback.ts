/**
 * Daily seller win-back (lib/sellerWinback.ts). Each ended subscription is
 * claimed in seller_winback_messages before anything is sent, so the message
 * goes out once even with several API instances.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, sellerWinbackMessages, users } from "@workspace/db";
import { logger } from "../lib/logger";
import { sendBrandthreadEmail } from "../lib/brandthreadEmail";
import { sendPushToUser } from "../lib/push";
import { isChannelEnabled } from "../lib/notificationChannels";
import { ENDED_STATUSES, WINBACK_PUSH, isWinbackDue, winbackEmail } from "../lib/sellerWinback";

const INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export async function runSellerWinback(now = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const rows = await db.select({
      clerkId: users.clerkId,
      email: users.email,
      brandName: users.brandName,
      status: users.subscriptionStatus,
      periodEnd: users.subscriptionPeriodEnd,
      preferences: users.notificationPreferences,
      products: sql<number>`(SELECT count(*)::int FROM products p WHERE p.owner_id = ${users.clerkId} AND p.deleted_at IS NULL)`,
    }).from(users).where(and(
      inArray(users.subscriptionStatus, [...ENDED_STATUSES]),
      isNull(users.deletedAt),
      sql`${users.subscriptionPeriodEnd} BETWEEN ${new Date(now.getTime() - 14 * DAY_MS)} AND ${new Date(now.getTime() - 7 * DAY_MS)}`,
    )).limit(500);

    for (const seller of rows) {
      if (!isWinbackDue({ status: seller.status, periodEnd: seller.periodEnd }, now) || !seller.periodEnd) continue;
      const [claimed] = await db.insert(sellerWinbackMessages)
        .values({ sellerId: seller.clerkId, periodEnd: seller.periodEnd })
        .onConflictDoNothing()
        .returning({ id: sellerWinbackMessages.id });
      if (!claimed) continue;
      const prefs = seller.preferences as Record<string, unknown> | null;
      let emailed = false;
      if (seller.email && isChannelEnabled(prefs, "subscription_trial", "email")) {
        const email = winbackEmail({ brandName: seller.brandName, productCount: Number(seller.products ?? 0) });
        emailed = await sendBrandthreadEmail({
          to: seller.email, subject: email.subject, html: email.html,
          idempotencyKey: `winback/${seller.clerkId}/${seller.periodEnd.toISOString()}`,
        });
      }
      let pushed = false;
      try {
        pushed = await sendPushToUser(seller.clerkId, {
          title: WINBACK_PUSH.title,
          body: WINBACK_PUSH.body,
          data: { type: "seller_winback", route: "/subscription" },
        }, "subscription");
      } catch (err) {
        logger.warn({ err, sellerId: seller.clerkId }, "Win-back push failed");
      }
      await db.update(sellerWinbackMessages).set({ emailSent: emailed, pushSent: !!pushed })
        .where(eq(sellerWinbackMessages.id, claimed.id));
      sent += 1;
    }
  } catch (err) {
    logger.error({ err, job: "sellerWinback" }, "Seller win-back job failed");
  }
  return { sent };
}

export function startSellerWinbackJob(): void {
  setTimeout(() => { void runSellerWinback(); }, 11 * 60 * 1000);
  setInterval(() => { void runSellerWinback(); }, INTERVAL_MS);
  logger.info({ job: "sellerWinback", intervalMs: INTERVAL_MS }, "Seller win-back job scheduled");
}
