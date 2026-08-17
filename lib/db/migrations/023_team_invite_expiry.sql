-- ─── Migration 023: Team invite expiry ───────────────────────────────────────
-- Adds expires_at to team_members so invite links have a 7-day TTL.
-- Existing pending rows are backfilled: invited_at + 7 days so recently sent
-- links get a fair window while stale ones (already > 7 days old) expire
-- immediately upon upgrade, closing the leaked-link vector.

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill all pending invites: invited_at + 7 days.
-- Rows where invited_at was > 7 days ago will have expires_at in the past
-- and will be rejected by the application-level expiry check.
UPDATE team_members
SET expires_at = invited_at + INTERVAL '7 days'
WHERE status = 'pending'
  AND expires_at IS NULL;
