-- 089: Buyer "recently viewed products" history.
--
-- One row per (buyer, product); viewing again bumps viewed_at rather than
-- creating a duplicate. Not a payout-path change.

CREATE TABLE IF NOT EXISTS recently_viewed_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS recently_viewed_products_user_product_unique
  ON recently_viewed_products (user_id, product_id);

CREATE INDEX IF NOT EXISTS recently_viewed_products_user_viewed_idx
  ON recently_viewed_products (user_id, viewed_at DESC);
