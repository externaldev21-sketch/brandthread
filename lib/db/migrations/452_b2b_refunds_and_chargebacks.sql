-- 452: Refunds of paid sample/bulk cards and B2B chargeback clawback
-- (Revenue P1: BT-459, BT-460). Additive only.
CREATE TABLE IF NOT EXISTS sample_order_refunds (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_order_id             UUID NOT NULL REFERENCES sample_orders(id) ON DELETE CASCADE,
  idempotency_key             TEXT NOT NULL UNIQUE,
  amount_cents                INTEGER NOT NULL CHECK (amount_cents > 0),
  platform_fee_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (platform_fee_refunded_cents >= 0),
  method                      TEXT NOT NULL,
  state                       TEXT NOT NULL DEFAULT 'pending',
  stripe_refund_id            TEXT,
  stripe_transfer_reversal_id TEXT,
  stripe_fee_refund_id        TEXT,
  reason                      TEXT,
  initiated_by_role           TEXT NOT NULL,
  initiated_by                TEXT,
  error                       TEXT,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sample_order_refunds_order_idx ON sample_order_refunds (sample_order_id);

-- Disputes on sample/bulk cards and freelancer jobs are listed with retail
-- disputes (admin) and record what was clawed back from the payee.
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS sample_order_id UUID,
  ADD COLUMN IF NOT EXISTS freelancer_job_id UUID,
  ADD COLUMN IF NOT EXISTS clawback_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_transfer_reversal_id TEXT;
CREATE INDEX IF NOT EXISTS disputes_sample_order_idx ON disputes (sample_order_id);
CREATE INDEX IF NOT EXISTS disputes_freelancer_job_idx ON disputes (freelancer_job_id);
