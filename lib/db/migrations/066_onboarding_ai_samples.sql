CREATE TABLE IF NOT EXISTS onboarding_ai_samples (
  account_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'reserved',
  reservation_id TEXT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS onboarding_ai_samples_reservation_idx
  ON onboarding_ai_samples (reservation_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'onboarding_ai_samples_status_check'
  ) THEN
    ALTER TABLE onboarding_ai_samples
      ADD CONSTRAINT onboarding_ai_samples_status_check
      CHECK (status IN ('reserved', 'completed'));
  END IF;
END $$;