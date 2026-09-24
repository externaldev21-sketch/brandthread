/**
 * Flushes the notification batch queue (src/lib/push.ts#enqueueBatchedNotification)
 * into single collapsed notifications. High-frequency, low-priority events
 * (currently: product likes) are enqueued instead of published immediately;
 * this job periodically turns each collapsed window into exactly one
 * publishNotification() call, so a seller gets "Maya and 4 others liked your
 * item" instead of five separate pushes.
 */
import { and, eq, lte } from "drizzle-orm";
import { db, notificationBatchQueue } from "@workspace/db";
import { logger } from "../lib/logger";
import { publishNotification } from "../routes/notifications-feed";

const INTERVAL_MS = 5 * 60 * 1000;
// A window stays open this long after its first event, collecting further
// events, before it is eligible to flush — this is what does the collapsing.
const BATCH_WINDOW_MS = 15 * 60 * 1000;

export function composeBatchedMessage(input: {
  type: string;
  count: number;
  actorNames: string[];
}): { title: string; body: string } {
  const [firstActor] = input.actorNames;
  const others = input.count - 1;
  const who = firstActor
    ? others > 0
      ? `${firstActor} and ${others} other${others === 1 ? "" : "s"}`
      : firstActor
    : `${input.count} people`;

  switch (input.type) {
    case "post_liked":
      return { title: "New likes", body: `${who} liked your post` };
    default:
      return { title: "New activity", body: `${who} interacted with your post` };
  }
}

export async function runNotificationBatchFlush(now = new Date()): Promise<{ flushed: number }> {
  let flushed = 0;
  try {
    const cutoff = new Date(now.getTime() - BATCH_WINDOW_MS);
    const due = await db.select().from(notificationBatchQueue)
      .where(lte(notificationBatchQueue.firstEventAt, cutoff));

    for (const row of due) {
      const message = composeBatchedMessage({
        type: row.type,
        count: row.count,
        actorNames: row.actorNames,
      });
      await publishNotification({
        userId: row.userId,
        category: row.category,
        type: row.type,
        title: message.title,
        body: message.body,
        targetId: row.targetId ?? undefined,
        targetType: row.targetType ?? undefined,
        cta: row.cta ?? undefined,
      });
      // Best-effort delete scoped to this exact row — a concurrent flush
      // (there should only ever be one worker, but this stays safe) cannot
      // double-delete because the delete is keyed by primary id.
      await db.delete(notificationBatchQueue).where(and(eq(notificationBatchQueue.id, row.id)));
      flushed += 1;
    }
  } catch (err) {
    logger.error({ err, job: "notificationBatchFlush" }, "Notification batch flush job failed");
  }
  return { flushed };
}

export function startNotificationBatchFlushJob(): void {
  setTimeout(() => { void runNotificationBatchFlush(); }, 60 * 1000);
  setInterval(() => { void runNotificationBatchFlush(); }, INTERVAL_MS);
  logger.info({ job: "notificationBatchFlush", intervalMs: INTERVAL_MS }, "Notification batch flush job scheduled");
}
