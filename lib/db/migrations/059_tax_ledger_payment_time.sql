-- ─── Migration 059: successful-payment time attribution ─────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

ALTER TABLE seller_tax_ledger
  ADD COLUMN IF NOT EXISTS paid_at_source TEXT NOT NULL DEFAULT 'historical_order_created_at';

-- Historical rows lack an authoritative provider payment timestamp in the
-- local database. Keep the fallback explicit so they can be reconciled without
-- presenting order creation time as proven payment time.
UPDATE seller_tax_ledger
SET paid_at_source = 'historical_order_created_at'
WHERE paid_at_source IS NULL OR paid_at_source = '';

ALTER TABLE seller_tax_ledger
  ALTER COLUMN paid_at_source SET DEFAULT 'stripe_event';