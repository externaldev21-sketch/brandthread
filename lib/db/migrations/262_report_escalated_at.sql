-- 262: Moderator escalation marker for member reports (App Store guideline 1.2).
-- The hourly escalation job (artifacts/api-server/src/jobs/reportEscalation.ts)
-- sets escalated_at in the same UPDATE that selects a report, so a report that
-- has waited 12+ hours is escalated to moderators exactly once, even with
-- several API replicas running the job.
--
-- Deliberately NOT declared in the drizzle `reports` table: the report
-- insert (.returning()) and the moderation queue (select()) list every
-- declared column, so declaring it would break filing reports on a deploy that
-- runs before this migration. Only the job touches it, through raw SQL that
-- tolerates the column being absent.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

-- The existing reports_status_created_idx (status, created_at) serves the
-- job's query; no new index is needed.
