CREATE TABLE IF NOT EXISTS design_studio_object_cleanup (
  object_path     TEXT PRIMARY KEY,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at      TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS design_studio_object_cleanup_due_idx
  ON design_studio_object_cleanup(next_attempt_at);