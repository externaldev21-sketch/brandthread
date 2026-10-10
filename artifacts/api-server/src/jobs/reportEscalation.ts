/**
 * Hourly: escalates member reports that have waited 12+ hours without a
 * moderator action, so nothing breaches the 24-hour review promise unseen.
 *
 * Safe with several replicas: the claim is one UPDATE ... RETURNING that sets
 * reports.escalated_at (migration 262) only where it is still NULL, so each
 * report is escalated exactly once across all instances and runs. Before
 * migration 262 is applied the claim fails, is logged, and the job retries on
 * the next tick; nothing else is affected.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { runReportEscalation as runEscalation, type EscalationDeps, type ReportForAlert } from "../lib/moderatorAlerts";
import { sendModeratorAlertNow } from "../lib/moderatorAlertsDelivery";

const INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

export const dbEscalationDeps: EscalationDeps = {
  async claimOverdue(cutoff, now, limit) {
    const result = await db.execute(sql`
      UPDATE reports SET escalated_at = ${now}
      WHERE id IN (
        SELECT id FROM reports
        WHERE status = 'pending' AND escalated_at IS NULL AND created_at < ${cutoff}
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      AND escalated_at IS NULL
      RETURNING id, target_type, target_label, reason, content_excerpt, created_at
    `);
    const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];
    return rows.map((row): ReportForAlert => ({
      id: String(row.id),
      targetType: String(row.target_type),
      targetLabel: (row.target_label as string | null) ?? null,
      reason: String(row.reason),
      contentExcerpt: (row.content_excerpt as string | null) ?? null,
      createdAt: row.created_at as Date | string,
    }));
  },
  send: sendModeratorAlertNow,
};

export async function runReportEscalation(now = new Date()): Promise<number> {
  try {
    const count = await runEscalation(now, dbEscalationDeps);
    if (count > 0) logger.warn({ job: "reportEscalation", count }, "Escalated reports waiting 12+ hours");
    return count;
  } catch (err) {
    logger.error({ err, job: "reportEscalation" }, "Report escalation run failed");
    return 0;
  }
}

export function startReportEscalationJob(): void {
  setTimeout(() => { void runReportEscalation(); }, FIRST_RUN_DELAY_MS);
  setInterval(() => { void runReportEscalation(); }, INTERVAL_MS);
  logger.info({ job: "reportEscalation", intervalMs: INTERVAL_MS }, "Report escalation job scheduled");
}
