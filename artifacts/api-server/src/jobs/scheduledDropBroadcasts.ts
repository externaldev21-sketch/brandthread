import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, drops } from "@workspace/db";
import { logger } from "../lib/logger";
import { deliverDropBroadcast } from "../lib/dropBroadcast";

const INTERVAL_MS = 60 * 1000;

/**
 * Delivers launch notifications that are due. The broadcast table claim in
 * deliverDropBroadcast makes overlapping workers and manual sends safe.
 */
export async function runScheduledDropBroadcasts(now = new Date()): Promise<void> {
  try {
    const dueDrops = await db.select({
      id: drops.id,
      ownerId: drops.ownerId,
    }).from(drops).where(and(
      eq(drops.status, "active"),
      isNotNull(drops.releaseAt),
      isNotNull(drops.scheduledBroadcastAt),
      lte(drops.releaseAt, now),
      lte(drops.scheduledBroadcastAt, now),
    ));

    for (const drop of dueDrops) {
      const result = await deliverDropBroadcast(drop.id, drop.ownerId, { scheduledNow: now });
      if (result) {
        logger.info({
          job: "scheduledDropBroadcasts",
          dropId: drop.id,
          sent: result.sent,
          errors: result.errors,
        }, "Scheduled drop broadcast delivered");
      }
    }
  } catch (err) {
    logger.error({ err, job: "scheduledDropBroadcasts" }, "Scheduled drop broadcast job failed");
  }
}

export function startScheduledDropBroadcastJob(): void {
  void runScheduledDropBroadcasts();
  setInterval(() => void runScheduledDropBroadcasts(), INTERVAL_MS);
  logger.info({ job: "scheduledDropBroadcasts", intervalMs: INTERVAL_MS }, "Scheduled drop broadcast job scheduled");
}