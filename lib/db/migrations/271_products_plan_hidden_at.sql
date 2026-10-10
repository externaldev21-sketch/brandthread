-- 271: Listings moved to drafts because the seller's plan no longer covers
-- them (downgrade, cancelled or lapsed plan). Hidden newest-first, never
-- deleted; restored oldest-first when the plan has room again. A seller who
-- changes the product's status themselves clears the mark.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS plan_hidden_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS products_plan_hidden_idx
  ON products (owner_id, plan_hidden_at)
  WHERE plan_hidden_at IS NOT NULL;
