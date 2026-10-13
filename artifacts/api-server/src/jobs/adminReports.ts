/**
 * Hourly tick for the internal owner reports (lib/admin/ownerReport.ts): the
 * Monday numbers email and the daily inactive-seller digest. Each report is
 * claimed in admin_report_runs before sending, so replicas and restarts never
 * send twice; a failed send releases the claim and the next tick retries.
 */
import { logger } from "../lib/logger";
import { runInactiveSellerDigest, runWeeklyOwnerReport } from "../lib/admin/ownerReport";

const INTERVAL_MS = 60 * 60 * 1000;

export async function runAdminReports(now = new Date()): Promise<void> {
  for (const [name, run] of [["weekly", runWeeklyOwnerReport], ["inactive_sellers", runInactiveSellerDigest]] as const) {
    try {
      const outcome = await run(now);
      if (outcome === "failed") logger.warn({ job: "adminReports", report: name }, "Owner report email failed; will retry next hour");
    } catch (err) {
      logger.error({ err, job: "adminReports", report: name }, "Owner report failed");
    }
  }
}

export function startAdminReportsJob(): void {
  const run = () => void runAdminReports();
  setTimeout(run, 90_000).unref?.();
  setInterval(run, INTERVAL_MS).unref?.();
  logger.info({ job: "adminReports", intervalMs: INTERVAL_MS }, "Owner reports job scheduled");
}
