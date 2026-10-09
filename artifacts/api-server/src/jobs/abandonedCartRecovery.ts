/**
 * Abandoned Cart Recovery — server-side background job.
 *
 * One reminder per abandonment window, 24 hours after the last cart change:
 * a push with its Activity row, plus an email. Items saved for later are
 * skipped.
 *
 * The window resets whenever the buyer syncs their cart (every app session
 * replaces the rows), so this only fires when someone genuinely hasn't
 * touched their cart for a day.
 *
 * Claim-before-notify: eligible cart items are claimed with a single
 * conditional UPDATE ... RETURNING before anything is sent. Postgres
 * serializes concurrent UPDATEs against the same rows, so if this job
 * overlaps itself or runs on more than one server instance only the run that
 * wins the row lock sees a given cart item in its RETURNING set. A given
 * user is therefore notified at most once per window, even under concurrent
 * execution.
 *
 * Each reminder applies the recipient's own switches: push and in-app via
 * publishNotification (Settings → Notifications → cart_reminders), email via
 * the email channel.
 */
import { db, cartItems, users } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { publishNotification } from "../routes/notifications-feed";
import { sendAbandonedCartEmail, type EmailLineItem } from "../lib/brandthreadEmail";
import { isChannelEnabledForUser } from "../lib/notificationChannels";

export const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 10 * 60 * 1000;

type ClaimedRow = { userId: string; itemData: unknown };

function groupByUser(rows: ClaimedRow[]): Map<string, EmailLineItem[]> {
  const byUser = new Map<string, EmailLineItem[]>();
  for (const row of rows) {
    const item = (row.itemData ?? {}) as Partial<{ productName: string; variantTitle: string; quantity: number; priceCents: number }>;
    const list = byUser.get(row.userId) ?? [];
    list.push({
      productName: item.productName || "Item in your cart",
      variantLabel: item.variantTitle || null,
      quantity: Math.max(1, Number(item.quantity) || 1),
      priceCents: Math.max(0, Number(item.priceCents) || 0),
    });
    byUser.set(row.userId, list);
  }
  return byUser;
}

function itemSummary(items: EmailLineItem[]): string {
  const first = items[0]!.productName;
  return items.length === 1 ? first : `${first} and ${items.length - 1} more`;
}

export async function runCartReminders(now: Date = new Date()): Promise<{ pushed: number; emailed: number }> {
  let pushed = 0;
  let emailed = 0;
  const cutoff = new Date(now.getTime() - REMINDER_AFTER_MS);

  try {
    const claimed = await db
      .update(cartItems)
      .set({ notifiedAbandonedAt: now, pushRemindedAt: now })
      .where(sql`${cartItems.updatedAt} < ${cutoff} AND ${cartItems.notifiedAbandonedAt} IS NULL AND ${cartItems.savedForLater} = false`)
      .returning({ userId: cartItems.userId, itemData: cartItems.itemData });

    const byUser = groupByUser(claimed);
    const userIds = [...byUser.keys()];
    if (userIds.length === 0) return { pushed, emailed };

    // Push + Activity row. If this fails after the claim above committed,
    // the user misses this window's reminder rather than risk a duplicate.
    for (const [userId, items] of byUser) {
      try {
        await publishNotification({
          userId,
          category: "orders",
          pushCategory: "cart",
          type: "abandoned_cart",
          title: "Still thinking it over?",
          body: `${itemSummary(items)} is waiting in your cart.`,
          targetType: "cart",
          cta: "Open your cart",
        });
        pushed += 1;
      } catch (err) {
        logger.warn({ err, userId, job: "abandonedCartRecovery" }, "Cart reminder failed");
      }
    }

    const emails = await db
      .select({ clerkId: users.clerkId, email: users.email })
      .from(users)
      .where(inArray(users.clerkId, userIds));
    for (const { clerkId, email } of emails) {
      try {
        if (!email || !(await isChannelEnabledForUser(clerkId, "cart", "email"))) continue;
        const sent = await sendAbandonedCartEmail({
          to: email,
          items: byUser.get(clerkId) ?? [],
          idempotencyKey: `abandoned-cart/${clerkId}/${now.toISOString().slice(0, 13)}`,
        });
        if (sent) emailed += 1;
      } catch (err) {
        logger.warn({ err, userId: clerkId, job: "abandonedCartRecovery" }, "Cart email reminder failed");
      }
    }
    logger.info({ job: "abandonedCartRecovery", notifiedUsers: userIds.length, pushed, emailed }, "Abandoned cart 24h reminders sent");
  } catch (err) {
    logger.error({ err, job: "abandonedCartRecovery" }, "Abandoned cart reminder job failed");
  }

  return { pushed, emailed };
}

export function startAbandonedCartJob(): void {
  // Run once shortly after startup (in case of server restart)
  setTimeout(() => void runCartReminders(), 5 * 60 * 1000);

  // Then run on the recurring interval
  setInterval(() => void runCartReminders(), INTERVAL_MS);

  logger.info({ job: "abandonedCartRecovery", intervalMs: INTERVAL_MS }, "Abandoned cart recovery job scheduled");
}
