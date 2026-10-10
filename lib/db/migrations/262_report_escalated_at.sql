-- 262: Moderator escalation marker for member reports (App Store guideline 1.2).
-- The hourly escalation job (artifacts/api-server/src/jobs/reportEscalation.ts)
-- sets escalated_at in the same UPDATE that selects a report, so a report that
-- has waited 12+ hours is escalated to moderators exactly once, even with
-- several API replicas running the job.
--
-- Also declared in the drizzle `reports` table (escalatedAt) so
-- `drizzle-kit push --force` keeps the column. Apply this migration before
-- deploying the code that selects it.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

-- The existing reports_status_created_idx (status, created_at) serves the
-- job's query; no new index is needed.
