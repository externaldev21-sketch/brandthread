-- Migration 093: Thread Cash daily reward moves from a button-tap check-in
-- to cumulative active foreground time (7 minutes/day). The existing
-- streak/ledger tables (085) are reused as-is; this only adds the
-- server-side heartbeat ledger that gates a claim, so a client can't just
-- fabricate "420 seconds elapsed" without the server having actually heard
-- from it a handful of times that day.

CREATE TABLE IF NOT EXISTS thread_cash_heartbeats (
  buyer_id        TEXT        NOT NULL,
  local_date      TEXT        NOT NULL, -- buyer-local YYYY-MM-DD
  heartbeat_count INTEGER     NOT NULL DEFAULT 0,
  active_seconds  INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (buyer_id, local_date)
);
