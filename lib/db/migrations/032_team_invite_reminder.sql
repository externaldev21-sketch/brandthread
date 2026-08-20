-- ─── Migration 032: Team invite reminder tracking ────────────────────────────
-- A nullable timestamp allows the reminder job to send at most one reminder
-- for each pending invite while leaving existing and accepted rows untouched.

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS reminder_claimed_at TIMESTAMPTZ;