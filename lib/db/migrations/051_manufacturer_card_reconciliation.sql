-- Existing development databases may have recorded migration 050 before
-- destination-charge reversal reconciliation added this linkage column.
ALTER TABLE sample_orders
  ADD COLUMN IF NOT EXISTS stripe_charge_id text;