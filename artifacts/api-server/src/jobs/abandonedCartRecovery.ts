/**
 * Abandoned Cart Recovery — server-side background job.
 *
 * Two reminders per abandonment window, both skipped for items saved for
 * later:
 *   - 1 hour after the last cart change: a push (plus its Activity row).
 *   - 24 hours after: an Activity row and an email.
 *
 * The window resets whenever the buyer syncs their cart (every app session
 * replaces the rows), so this only fires when someone genuinely hasn't
 * touched their cart.
 *
 * Claim-before-notify: eligible cart items are claimed with a single
 * conditional UPDATE ... RETURNING before anything is sent. Postgres
 * serializes concurrent UPDATEs against the same rows, so if this job
 * overlaps itself or runs on more than one server instance only the run that
 * wins the row lock sees a given cart item in its RETURNING set. A given
 * user is therefore notified at most once per channel per window, even under
 * concurrent execution. The push stage only claims carts younger than the
 * 24-hour window, so a long-idle cart gets the 24-hour reminder and not both
 * at once.
 *
 * Each reminder applies the recipient's own switches: push and in-app via
 * publishNotification (Settings → Notifications → cart_reminders), email via
 * the email channel.
 */
import { db, cartItems, notificationsFeed, users } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { publishNotification } from "../routes/notifications-feed";
import { sendAbandonedCartEmail, type EmailLineItem } from "../lib/brandthreadEmail";
import { isChannelEnabledForUser } from "../lib/notificationChannels";

export const PUSH_REMINDER_AFTER_MS = 60 * 60 * 1000;
export const EMAIL_REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Never nudge a buyer about a line whose product was deleted or taken off
 * sale. The line is matched by the stored productId, else its variant.
 */
function cartLineStillForSale() {
  return sql`NOT EXISTS (
    SELECT 1 FROM products p
    WHERE (p.id::text = ${cartItems.itemData}->>'productId'
        OR p.id IN (SELECT pv.product_id FROM product_variants pv WHERE pv.id::text = ${cartItems.variantId}))
      AND (p.deleted_at IS NOT NULL OR p.status <> 'active')
  )`;
}

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

  const pushCutoff = new Date(now.getTime() - PUSH_REMINDER_AFTER_MS);
  const emailCutoff = new Date(now.getTime() - EMAIL_REMINDER_AFTER_MS);

  // 1 hour: push.
  try {
    const claimed = await db
      .update(cartItems)
      .set({ pushRemindedAt: now })
      .where(sql`${cartItems.updatedAt} < ${pushCutoff}
        AND ${cartItems.updatedAt} >= ${emailCutoff}
        AND ${cartItems.pushRemindedAt} IS NULL
        AND ${cartItems.notifiedAbandonedAt} IS NULL
        AND ${cartItems.savedForLater} = false
        AND ${cartLineStillForSale()}`)
      .returning({ userId: cartItems.userId, itemData: cartItems.itemData });

    for (const [userId, items] of groupByUser(claimed)) {
      try {
        await publishNotification({
          userId,
          category: "orders",
          pushCategory: "cart",
          type: "cart_reminder",
          title: "Still thinking it over?",
          body: `${itemSummary(items)} is waiting in your cart.`,
          targetType: "cart",
          cta: "Open your cart",
        });
        pushed += 1;
      } catch (err) {
        logger.warn({ err, userId, job: "abandonedCartRecovery" }, "Cart push reminder failed");
      }
    }
  } catch (err) {
    logger.error({ err, job: "abandonedCartRecovery", stage: "push" }, "Abandoned cart push stage failed");
  }

  // 24 hours: Activity row + email.
  try {
    const claimed = await db
      .update(cartItems)
      .set({ notifiedAbandonedAt: now })
      .where(sql`${cartItems.updatedAt} < ${emailCutoff} AND ${cartItems.notifiedAbandonedAt} IS NULL AND ${cartItems.savedForLater} = false AND ${cartLineStillForSale()}`)
      .returning({ userId: cartItems.userId, itemData: cartItems.itemData });

    const byUser = groupByUser(claimed);
    const userIds = [...byUser.keys()];
    if (userIds.length > 0) {
      const inAppOn = new Map<string, boolean>();
      for (const userId of userIds) {
        inAppOn.set(userId, await isChannelEnabledForUser(userId, "cart", "inApp").catch(() => true));
      }
      // If this insert fails after the claim above committed, those users
      // miss this window's reminder rather than risk a duplicate.
      const feedUsers = userIds.filter((userId) => inAppOn.get(userId));
      if (feedUsers.length > 0) {
        await db.insert(notificationsFeed).values(feedUsers.map((userId) => ({
          userId,
          category: "order",
          type: "abandoned_cart",
          title: "Still thinking it over?",
          body: "You left something in your cart. Tap to finish your order before it sells out.",
          targetType: "cart",
        })));
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
      logger.info({ job: "abandonedCartRecovery", notifiedUsers: userIds.length, emailed }, "Abandoned cart 24h reminders sent");
    }
  } catch (err) {
    logger.error({ err, job: "abandonedCartRecovery", stage: "email" }, "Abandoned cart email stage failed");
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
