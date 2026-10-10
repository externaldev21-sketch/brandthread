/**
 * Weekly seller summary: Monday 9am in the seller's time zone, one email
 * (sales, orders, store visits, top product, orders to ship — or "3 things
 * to try" in a week with no sales) and one push. Runs hourly; each seller's
 * week is claimed in seller_lifecycle_messages so it is sent once.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { logger } from "../lib/logger";
import { sendBrandthreadEmail } from "../lib/brandthreadEmail";
import { publishNotification } from "../routes/notifications-feed";
import { claimLifecycleMessage, markLifecycleDelivered } from "../lib/sellerLifecycle/claims";
import { buildWeeklySummary, isoWeekKey, isWeeklySummaryHour, weekLabel } from "../lib/sellerLifecycle/weekly";
import { money, weeklySummaryEmail } from "../lib/sellerLifecycle/emails";
import { sellerTipsEnabled, sellerTipsUnsubscribeUrl } from "../lib/sellerLifecycle/unsubscribe";

const INTERVAL_MS = 60 * 60 * 1000;
export const WEEKLY_SUMMARY_KIND = "weekly_summary";

export async function runSellerWeeklySummary(now = new Date()): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const sellers = await db.select({
      clerkId: users.clerkId,
      email: users.email,
      timeZone: users.quietHoursTimezone,
      preferences: users.notificationPreferences,
    }).from(users).where(and(
      or(eq(users.accountType, "seller"), eq(users.accountType, "both")),
      eq(users.onboardingComplete, true),
      isNull(users.deletedAt),
      isNull(users.suspendedAt),
      sql`EXISTS (SELECT 1 FROM products p WHERE p.owner_id = ${users.clerkId} AND p.deleted_at IS NULL)`,
    ));
    for (const seller of sellers) {
      if (!isWeeklySummaryHour(now, seller.timeZone)) continue;
      const wantsEmail = !!seller.email && sellerTipsEnabled(seller.preferences, "email");
      const wantsPush = sellerTipsEnabled(seller.preferences, "push");
      if (!wantsEmail && !wantsPush) continue;
      const week = isoWeekKey(now, seller.timeZone);
      if (!await claimLifecycleMessage(seller.clerkId, WEEKLY_SUMMARY_KIND, week)) continue;
      const summary = await buildWeeklySummary(seller.clerkId, now);
      let emailed = false;
      if (wantsEmail) {
        const email = weeklySummaryEmail(summary, weekLabel(now), sellerTipsUnsubscribeUrl(seller.clerkId));
        emailed = await sendBrandthreadEmail({ to: seller.email!, subject: email.subject, html: email.html, idempotencyKey: `${WEEKLY_SUMMARY_KIND}/${seller.clerkId}/${week}` });
      }
      let pushed = false;
      if (wantsPush) {
        await publishNotification({
          userId: seller.clerkId,
          category: "orders",
          pushCategory: "order",
          type: "seller_weekly_summary",
          title: summary.orderCount > 0 ? `Your week: ${money(summary.salesCents)} in sales` : "Your week on Brandthread",
          body: summary.orderCount > 0
            ? `${summary.orderCount} order${summary.orderCount === 1 ? "" : "s"} and ${summary.visits} store visit${summary.visits === 1 ? "" : "s"}.${summary.toShipCount ? ` ${summary.toShipCount} to ship.` : ""}`
            : `${summary.visits} store visit${summary.visits === 1 ? "" : "s"} and no sales yet. Share your store to get your next order.`,
          targetType: "seller_setup",
          targetId: summary.toShipCount > 0 ? "/(tabs)/orders" : "/(tabs)/analytics",
        }).then(() => { pushed = true; }).catch((err) => logger.warn({ err, sellerId: seller.clerkId }, "Weekly summary push failed"));
      }
      await markLifecycleDelivered(seller.clerkId, WEEKLY_SUMMARY_KIND, week, { push: pushed, email: emailed });
      sent += 1;
    }
  } catch (err) {
    logger.error({ err, job: "sellerWeeklySummary" }, "Seller weekly summary failed");
  }
  return { sent };
}

export function startSellerWeeklySummaryJob(): void {
  setTimeout(() => { void runSellerWeeklySummary(); }, 9 * 60 * 1000);
  setInterval(() => { void runSellerWeeklySummary(); }, INTERVAL_MS);
  logger.info({ job: "sellerWeeklySummary", intervalMs: INTERVAL_MS }, "Seller weekly summary job scheduled");
}
