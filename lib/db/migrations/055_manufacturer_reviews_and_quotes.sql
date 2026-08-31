CREATE TABLE IF NOT EXISTS manufacturer_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  manufacturer_id UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  sample_order_id UUID NOT NULL REFERENCES sample_orders(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  quality_rating INTEGER NOT NULL CHECK (quality_rating BETWEEN 1 AND 5),
  communication_rating INTEGER NOT NULL CHECK (communication_rating BETWEEN 1 AND 5),
  delivery_rating INTEGER NOT NULL CHECK (delivery_rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS manufacturer_reviews_order_unique
  ON manufacturer_reviews (sample_order_id);
CREATE INDEX IF NOT EXISTS manufacturer_reviews_manufacturer_idx
  ON manufacturer_reviews (manufacturer_id);
CREATE INDEX IF NOT EXISTS manufacturer_reviews_seller_idx
  ON manufacturer_reviews (seller_id);

ALTER TABLE seller_quote_requests
  ADD COLUMN IF NOT EXISTS quote_valid_until TIMESTAMP;
ALTER TABLE seller_quote_requests
  ADD COLUMN IF NOT EXISTS counteroffer JSON;
CREATE INDEX IF NOT EXISTS seller_quote_requests_seller_idx
  ON seller_quote_requests (seller_id);

UPDATE manufacturers AS m
SET rating_basis_points = COALESCE((
  SELECT ROUND(AVG(r.rating) * 100)::integer
  FROM manufacturer_reviews AS r
  WHERE r.manufacturer_id = m.id
), 0);