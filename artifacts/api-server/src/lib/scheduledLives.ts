/**
 * Scheduled lives: reminder delivery and the "seller went live" hand-off.
 *
 * Both notifications are claimed with a timestamp column on the row
 * (`reminder_sent_at` / `started_notified_at`) in a single UPDATE ... RETURNING,
 * so overlapping workers and retries deliver each one at most once.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";
import { REMINDER_LEAD_MS, reminderCopy } from "./liveCommerce";

type ScheduledRow = { id: string; seller_id: string; title: string; starts_at: Date | string };

async function reminderUserIds(scheduledLiveId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT r.user_id
    FROM scheduled_live_reminders r
    WHERE r.scheduled_live_id = ${scheduledLiveId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = r.user_id AND b.blocked_id = (SELECT seller_id FROM scheduled_lives WHERE id = ${scheduledLiveId}::uuid))
           OR (b.blocked_id = r.user_id AND b.blocker_id = (SELECT seller_id FROM scheduled_lives WHERE id = ${scheduledLiveId}::uuid))
      )
  `);
  return (rows.rows as Array<{ user_id: string }>).map((r) => r.user_id);
}

async function sellerLabel(sellerId: string): Promise<string> {
  const rows = await db.execute(sql`
    SELECT COALESCE(NULLIF(brand_name, ''), display_name, 'A seller') AS label FROM users WHERE clerk_id = ${sellerId} LIMIT 1
  `);
  return ((rows.rows[0] as any)?.label as string | undefined) ?? "A seller";
}

async function notifyAll(userIds: string[], build: (userId: string) => Parameters<typeof publishNotification>[0]): Promise<number> {
  const results = await Promise.allSettled(userIds.map((id) => publishNotification(build(id))));
  return results.filter((r) => r.status === "fulfilled").length;
}

/** Sends the "starting soon" reminder for every scheduled live inside the lead window. Returns lives notified. */
export async function sendDueReminders(now: Date = new Date(), leadMs: number = REMINDER_LEAD_MS): Promise<number> {
  const horizon = new Date(now.getTime() + leadMs);
  const floor = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const claimed = await db.execute(sql`
    UPDATE scheduled_lives
    SET reminder_sent_at = ${now}
    WHERE id IN (
      SELECT id FROM scheduled_lives
      WHERE status = 'scheduled'
        AND reminder_sent_at IS NULL
        AND starts_at <= ${horizon}
        AND starts_at > ${floor}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, seller_id, title, starts_at
  `);
  let notified = 0;
  for (const row of claimed.rows as ScheduledRow[]) {
    try {
      const userIds = await reminderUserIds(row.id);
      const label = await sellerLabel(row.seller_id);
      const copy = reminderCopy(row.title, new Date(row.starts_at), now);
      await notifyAll(userIds, (userId) => ({
        userId,
        category: "drops",
        type: "live_reminder",
        title: copy.title,
        body: `${label}: ${copy.body}`,
        targetId: row.id,
        targetType: "scheduled_live",
        actorId: row.seller_id,
        cta: "View live",
        analyticsOwnerId: row.seller_id,
        pushChannelId: "drops",
      }));
      notified += 1;
    } catch (err) {
      logger.error({ err, scheduledLiveId: row.id }, "scheduled live reminder failed");
    }
  }
  return notified;
}

/**
 * Called when a seller starts a stream from a scheduled entry: links the two,
 * flips the entry to 'live', and notifies everyone who asked to be reminded
 * (once). Returns false when the entry isn't this seller's or isn't pending.
 */
export async function markScheduledLiveStarted(input: {
  scheduledLiveId: string;
  sellerId: string;
  streamId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const claimed = await db.execute(sql`
    UPDATE scheduled_lives
    SET status = 'live', stream_id = ${input.streamId}::uuid, started_notified_at = ${now}
    WHERE id = ${input.scheduledLiveId}::uuid
      AND seller_id = ${input.sellerId}
      AND status = 'scheduled'
    RETURNING id, seller_id, title, starts_at
  `);
  const row = claimed.rows[0] as ScheduledRow | undefined;
  if (!row) return false;
  const userIds = await reminderUserIds(row.id);
  const label = await sellerLabel(row.seller_id);
  await notifyAll(userIds, (userId) => ({
    userId,
    category: "drops",
    type: "live_started",
    title: `${label} is live now`,
    body: `${row.title} just started. Tap to watch.`,
    targetId: input.streamId,
    targetType: "live",
    actorId: row.seller_id,
    cta: "Watch live",
    analyticsOwnerId: row.seller_id,
    pushChannelId: "drops",
  }));
  return true;
}
