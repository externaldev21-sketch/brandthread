-- Migration 301: bundles priced at checkout.
--
-- A bundle's discount is decided server-side when a cart is priced
-- (api-server lib/money/bundlePricing.ts), fixed on the checkout row, and
-- carried onto the paid order by the webhook so sellers can see which
-- bundle sold and what it cost them. Safe to rerun.

-- What the checkout decided (the items JSON also carries each line's bundleId).
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS bundle_discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS bundle_lines JSONB NOT NULL DEFAULT '[]'::jsonb;

-- On the order: the total bundle saving (already inside discount_amount_cents,
-- which is the whole Stripe discount) and one entry per applied bundle:
-- [{ bundleId, name, sets, itemsCents, bundlePriceCents, discountCents }].
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bundle_discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bundle_lines JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Which bundle a sold line belonged to (NULL for lines bought on their own).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_id UUID;
CREATE INDEX IF NOT EXISTS order_items_bundle_id_idx ON order_items (bundle_id) WHERE bundle_id IS NOT NULL;
