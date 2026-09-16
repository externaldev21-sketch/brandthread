CREATE TABLE IF NOT EXISTS seller_cashout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  stripe_payout_id TEXT,
  response_status TEXT,
  response_arrival_date TIMESTAMPTZ,
  error_http_status INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('processing', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS seller_cashout_attempts_owner_idx
  ON seller_cashout_attempts(owner_id);

CREATE UNIQUE INDEX IF NOT EXISTS seller_cashout_attempts_owner_idempotency_unique
  ON seller_cashout_attempts(owner_id, idempotency_key);