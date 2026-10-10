-- One free onboarding AI logo sample per person/device, not just per account.
-- Each row is a hashed claim key (email, device or a per-day IP slot) tied to
-- the account reservation that took it. Re-running a sign-up with a fresh
-- account on the same device or email finds the key already claimed.
CREATE TABLE IF NOT EXISTS onboarding_ai_sample_claims (
  claim_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  account_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS onboarding_ai_sample_claims_reservation_idx
  ON onboarding_ai_sample_claims (reservation_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'onboarding_ai_sample_claims_status_check'
  ) THEN
    ALTER TABLE onboarding_ai_sample_claims
      ADD CONSTRAINT onboarding_ai_sample_claims_status_check
      CHECK (status IN ('reserved', 'completed'));
  END IF;
END $$;
