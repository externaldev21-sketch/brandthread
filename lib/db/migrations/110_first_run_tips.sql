-- ─── Migration 110: First-run tips (per-account "seen" tracking) ─────────────
-- Server-side source of truth for the first-run tips system (gesture hints,
-- spotlight coach marks, anchored cards, full-screen gesture sheets) so a
-- tip already seen on one device never replays after a reinstall or on a new
-- device. See artifacts/mobile/lib/firstRunTips for the client-side local
-- cache + reconcile logic and artifacts/api-server/src/routes/first-run-tips.ts
-- for the API surface.

CREATE TABLE IF NOT EXISTS first_run_tips_seen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  tip_id TEXT NOT NULL,
  seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS first_run_tips_seen_user_tip_unique
  ON first_run_tips_seen (user_id, tip_id);

CREATE INDEX IF NOT EXISTS first_run_tips_seen_user_id_idx
  ON first_run_tips_seen (user_id);

-- "Skip all tips" — a single global per-account setting that suppresses
-- every future first-run tip once set.
CREATE TABLE IF NOT EXISTS first_run_tips_settings (
  user_id TEXT PRIMARY KEY,
  skip_all BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
