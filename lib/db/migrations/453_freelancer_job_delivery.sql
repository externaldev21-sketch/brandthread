-- ─── Migration 453: Freelancer job delivery + hirer approval (BT-446) ────────
-- The freelancer no longer completes (and pays themselves for) a job. They
-- DELIVER it; the hirer approves, requests a revision, or reports a problem.
--
-- Lifecycle (freelancer_jobs.status, plain TEXT, no CHECK constraint):
--   pending → accepted → in_progress → delivered → completed
--                              ↑            │
--                              └─ revision ─┤   (hirer, max 3 revisions)
--                                           └→ disputed  (hirer report, or a
--                                                         card chargeback)
--   cancelled: pending/accepted/in_progress (refunds the hirer); a freelancer
--   may also cancel a delivered job (refund). Nobody cancels a disputed job
--   from the app.
--
-- Money moves (stripe transfer of freelancer_payout_cents) ONLY on the
-- delivered → completed claim: hirer approval, or auto-release after
-- FREELANCER_AUTO_RELEASE_DAYS (default 3) with no hirer action.
-- 'disputed' freezes release: nothing in the release path claims a disputed
-- job. The chargeback handler (webhooks.ts, separate PR) sets
-- status = 'disputed', disputed_at = now(), dispute_opened_by = 'chargeback'.
--
-- stripe_transfer_id (migration 021) stays the single nullable source of
-- truth for "was the freelancer paid": NULL = no payout yet.

ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS delivered_at             TIMESTAMP;
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS delivery_note            TEXT;
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS revision_count           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS revision_note            TEXT;
-- When an untouched delivery is approved automatically (NULL unless delivered).
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS auto_release_at          TIMESTAMP;
-- Set once the hirer got the "1 day left" reminder for the current delivery.
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS auto_release_reminded_at TIMESTAMP;
-- 'hirer' | 'auto' | 'admin' — who released the payout.
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS approved_by              TEXT;
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS disputed_at              TIMESTAMP;
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS dispute_reason           TEXT;
-- 'hirer' | 'chargeback'
ALTER TABLE freelancer_jobs ADD COLUMN IF NOT EXISTS dispute_opened_by        TEXT;

CREATE INDEX IF NOT EXISTS freelancer_jobs_auto_release_idx
  ON freelancer_jobs(auto_release_at)
  WHERE status = 'delivered';
