-- 116: Thread Cash expiry. Credits expire earned_at + thread_cash_config.expiry_days
-- (null = never). Expiry is appended to the ledger as `expiry` entries keyed
-- `expiry:<lot entry id>` (thread_cash_entries_idempotency_key_unique makes
-- each lot expire at most once). This adds the read index the lot replay and
-- ledger screen use, and the once-per-day "expiring soon" warning record.
CREATE INDEX IF NOT EXISTS thread_cash_entries_buyer_created_idx
  ON thread_cash_entries (buyer_id, created_at, id);

CREATE TABLE IF NOT EXISTS thread_cash_expiry_warnings (
  buyer_id     TEXT        NOT NULL,
  -- UTC YYYY-MM-DD of the earliest lapse the warning covered
  expires_on   TEXT        NOT NULL,
  amount_cents INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (buyer_id, expires_on)
);
