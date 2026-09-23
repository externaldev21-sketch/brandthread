CREATE TABLE IF NOT EXISTS release_test_failure_claims (
  buyer_id TEXT PRIMARY KEY,
  failure_kind TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS release_test_failure_claims_expires_at_idx
  ON release_test_failure_claims (expires_at);