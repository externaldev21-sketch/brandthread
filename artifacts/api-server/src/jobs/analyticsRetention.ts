import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { scheduleJob } from "./runner";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = DAY_MS;
const BATCH_SIZE = 5000;
export const EVENT_RETENTION_DAYS = 400;

/**
 * Prunes seller analytics event rows older than 400 days. Only the new
 * seller_product_events table is touched; store_visits is deliberately left
 * alone (see PR notes) and seller_goals is configuration, not an event log.
 */
export async function runAnalyticsRetention(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY_MS).toISOString();
  let total = 0;
  for (;;) {
    const res = await db.execute(sql`
      DELETE FROM seller_product_events WHERE id IN (
        SELECT id FROM seller_product_events WHERE created_at < ${cutoff}::timestamp LIMIT ${BATCH_SIZE}
      )`);
    const n = Number((res as { rowCount?: number | null }).rowCount ?? 0);
    total += n;
    if (n < BATCH_SIZE) break;
  }
  if (total > 0) logger.info({ job: "analyticsRetention", deleted: total }, "Old seller analytics events pruned");
  return total;
}

export function startAnalyticsRetentionJob(): void {
  scheduleJob("analyticsRetention", () => runAnalyticsRetention(), { intervalMs: INTERVAL_MS, initialDelayMs: 120_000 });
}
