-- 276: "Day 1" badge. The first 100 distinct buyers of each brand keep a
-- small permanent badge for that brand (shown in the brand's comments and on
-- the buyer's profile). Rank 1..100 per seller, in order of first paid order.
CREATE TABLE IF NOT EXISTS brand_day_one_buyers (
  seller_id text NOT NULL,
  buyer_id text NOT NULL,
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 100),
  order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, buyer_id),
  CONSTRAINT brand_day_one_buyers_seller_rank_unique UNIQUE (seller_id, rank)
);
CREATE INDEX IF NOT EXISTS brand_day_one_buyers_buyer_idx ON brand_day_one_buyers (buyer_id, created_at);

-- Backfill from order history: each brand's first 100 distinct signed-in
-- buyers by their first paid order (not cancelled, not the seller themself).
INSERT INTO brand_day_one_buyers (seller_id, buyer_id, rank, order_id, created_at)
SELECT owner_id, buyer_id, rn, order_id, first_at
FROM (
  SELECT owner_id, buyer_id, order_id, first_at,
         row_number() OVER (PARTITION BY owner_id ORDER BY first_at, order_id) AS rn
  FROM (
    SELECT DISTINCT ON (owner_id, buyer_id) owner_id, buyer_id, id AS order_id, paid_at AS first_at
    FROM orders
    WHERE buyer_id IS NOT NULL AND owner_id <> '' AND buyer_id <> owner_id
      AND paid_at IS NOT NULL AND status NOT IN ('cancelled', 'refund_pending')
    ORDER BY owner_id, buyer_id, paid_at, id
  ) firsts
) ranked
WHERE rn <= 100
ON CONFLICT DO NOTHING;
