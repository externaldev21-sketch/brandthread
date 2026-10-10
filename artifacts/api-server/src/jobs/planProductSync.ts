/**
 * Hourly: brings live listings in line with each seller's plan when no
 * webhook said so (a trial or past_due grace period running out, a missed
 * delivery). Candidates are sellers with live listings and no active or
 * trialing Stripe plan or live store subscription, plus sellers with
 * plan-hidden drafts that may fit again. lib/planProductSync.ts decides;
 * every step is idempotent, so overlapping servers are safe.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { syncProductsToPlan } from "../lib/planProductSync";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 500;
let running = false;

export async function planProductSyncCandidates(limit = BATCH): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT p.owner_id AS owner_id
    FROM products p
    JOIN users u ON u.clerk_id = p.owner_id
    WHERE p.deleted_at IS NULL
      AND (
        p.plan_hidden_at IS NOT NULL
        OR (
          p.status = 'active'
          AND COALESCE(u.is_review_account, false) = false
          AND COALESCE(u.subscription_status, 'none') NOT IN ('active', 'trialing')
          AND NOT EXISTS (
            SELECT 1 FROM seller_subscription_entitlements e
            WHERE e.clerk_user_id = p.owner_id
              AND e.provider = 'revenuecat'
              AND e.status IN ('active', 'trial', 'grace')
              AND e.expires_at > now()
          )
        )
      )
    LIMIT ${limit}
  `) as unknown as { rows?: Array<{ owner_id: string }> };
  return (result.rows ?? []).map((row) => row.owner_id);
}

export async function runPlanProductSyncJob(): Promise<{ sellers: number; hidden: number; restored: number }> {
  const totals = { sellers: 0, hidden: 0, restored: 0 };
  if (running) return totals;
  running = true;
  try {
    for (const ownerId of await planProductSyncCandidates()) {
      try {
        const change = await syncProductsToPlan(ownerId);
        totals.sellers++;
        totals.hidden += change.hidden.length;
        totals.restored += change.restored.length;
      } catch (err) {
        logger.error({ err, ownerId, job: "planProductSync" }, "Plan product sync failed for a seller");
      }
    }
    if (totals.hidden || totals.restored) logger.info({ job: "planProductSync", ...totals }, "Plan product sync made changes");
  } catch (err) {
    logger.error({ err, job: "planProductSync" }, "Plan product sync failed");
  } finally {
    running = false;
  }
  return totals;
}

export function startPlanProductSyncJob(): void {
  if (process.env.PLAN_PRODUCT_SYNC === "off") {
    logger.warn({ job: "planProductSync" }, "Plan product sync is off (PLAN_PRODUCT_SYNC=off)");
    return;
  }
  void runPlanProductSyncJob();
  setInterval(() => void runPlanProductSyncJob(), INTERVAL_MS).unref?.();
  logger.info({ job: "planProductSync", intervalMs: INTERVAL_MS }, "Plan product sync job scheduled");
}
