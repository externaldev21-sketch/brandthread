-- 274: Pop-up mode (in-person Tap to Pay via Stripe Terminal).
-- seller_locations has been queried by routes/seller-locations.ts with raw SQL
-- but was never created by a migration; create it idempotently so Pop-up mode
-- (and the existing Locations screen) work on a fresh database.
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
  created_at             TIMESTAMP NOT NULL DEFAULT now(),
  updated_at             TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_locations_owner_idx ON seller_locations (owner_id);

-- One Stripe Terminal Location per seller (platform account).
CREATE TABLE IF NOT EXISTS seller_terminal_locations (
  seller_id          TEXT PRIMARY KEY,
  seller_location_id UUID,
  stripe_location_id TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sales channel: NULL = online, 'popup' = in-person Pop-up mode sale.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS source TEXT;
