-- ─── Migration 117: Seller settings table + checkout tips ──────────────────
-- routes/seller-settings-route.ts has always read and written
-- seller_settings (store language, and now the Checkout settings screen's
-- checkout mode and tipping switch), but no migration ever created it.
-- `settings` is a JSON object merged on every PATCH.
CREATE TABLE IF NOT EXISTS seller_settings (
  owner_id   TEXT PRIMARY KEY,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One-page checkout: the tip the buyer added for this seller group (part of
-- amount_total_cents; paid out to the seller with the rest of the order).
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0;
