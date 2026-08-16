-- Migration 006: Trust signals — verified seller, seller policies, buyer reviews

-- Add verified + policy fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS return_policy TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_policy TEXT;

-- Reviews table (1 review per buyer per order)
CREATE TABLE IF NOT EXISTS reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id   TEXT NOT NULL,
  seller_id  TEXT NOT NULL,
  order_id   UUID REFERENCES orders(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (buyer_id, order_id)
);
CREATE INDEX IF NOT EXISTS reviews_seller_id_idx  ON reviews(seller_id);
CREATE INDEX IF NOT EXISTS reviews_product_id_idx ON reviews(product_id);
