-- Keep new ledger rows aligned with the Drizzle schema after historical rows
-- were labeled by migration 059.
ALTER TABLE seller_tax_ledger
  ALTER COLUMN paid_at_source SET DEFAULT 'stripe_event';