-- 085: Seller order fulfillment (packing checklist, saved package presets,
-- Shippo tracking webhook idempotency ledger). Not a money-path change —
-- shipping label purchase/void and escrow ledger tables are untouched.

-- ── Packing checklist state on orders ───────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_picked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_packed BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Saved box/parcel presets ─────────────────────────────────────────────────
-- weight_oz: ounces. length_in/width_in/height_in: inches.
CREATE TABLE IF NOT EXISTS seller_package_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  weight_oz   INTEGER NOT NULL,
  length_in   NUMERIC(6,2) NOT NULL,
  width_in    NUMERIC(6,2) NOT NULL,
  height_in   NUMERIC(6,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seller_package_presets_owner_idx ON seller_package_presets (owner_id);

-- ── Shippo tracking webhook idempotency ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS shippo_webhook_events (
  id           TEXT PRIMARY KEY, -- `${transactionId}:${status}`
  order_id     UUID,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
