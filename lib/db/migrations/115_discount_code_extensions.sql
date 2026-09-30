-- Migration 115: discount code extensions (first-order-only, collection scope,
-- per-customer use limit, minimum quantity). Additive only.
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS first_order_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS collection_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS max_uses_per_customer INTEGER;
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS min_quantity INTEGER NOT NULL DEFAULT 0;
