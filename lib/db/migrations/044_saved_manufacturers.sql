CREATE TABLE IF NOT EXISTS saved_manufacturers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id text NOT NULL,
  manufacturer_id uuid NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS saved_manufacturers_seller_manufacturer_unique
  ON saved_manufacturers(seller_id, manufacturer_id);

CREATE INDEX IF NOT EXISTS saved_manufacturers_seller_idx
  ON saved_manufacturers(seller_id);

CREATE INDEX IF NOT EXISTS saved_manufacturers_manufacturer_idx
  ON saved_manufacturers(manufacturer_id);