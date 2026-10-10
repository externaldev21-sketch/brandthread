-- 510: Seller ship-from locations + carrier label adjustments.
--
-- seller_locations backs Settings → Locations (routes/seller-locations.ts),
-- which had no table. The primary active location is the seller's ship-from
-- address for shipping labels, so a label never falls back to the buyer's
-- own address as the sender.
CREATE TABLE IF NOT EXISTS seller_locations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id               TEXT NOT NULL,
  name                   TEXT NOT NULL,
  address                TEXT,
  city                   TEXT,
  state                  TEXT,
  country                TEXT NOT NULL DEFAULT 'US',
  zip                    TEXT,
  phone                  TEXT,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  is_primary             BOOLEAN NOT NULL DEFAULT FALSE,
  fulfills_online_orders BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seller_locations_owner_idx ON seller_locations(owner_id);

-- A carrier re-weigh / re-size surcharge on a label Brandthread bought
-- through its Shippo account. Each adjustment is recovered from the seller
-- once (external_id is the carrier/Shippo adjustment id).
CREATE TABLE IF NOT EXISTS shipping_label_adjustments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id        TEXT NOT NULL,
  label_id           UUID NOT NULL REFERENCES shipping_labels(id) ON DELETE CASCADE,
  order_id           UUID NOT NULL,
  owner_id           TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  reason             TEXT,
  -- from_held | recovered | owed
  status             TEXT NOT NULL DEFAULT 'owed',
  stripe_reversal_id TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS shipping_label_adjustments_external_unique ON shipping_label_adjustments(external_id);
CREATE INDEX IF NOT EXISTS shipping_label_adjustments_owner_idx ON shipping_label_adjustments(owner_id);
