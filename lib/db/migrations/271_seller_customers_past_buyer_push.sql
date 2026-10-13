-- 271: Seller money tools 2 — customers by lifetime spend + message past buyers.
--
-- 1. customers.tags / customers.notes: until now these were only added by an
--    ALTER at api-server startup (routes/customers.ts). The Customers list now
--    reads them on every request, so make them part of the migration chain.
-- 2. seller_push_broadcasts.audience: 'followers' (existing behaviour, one per
--    rolling 24h) or 'past_buyers' (buyers with a non-cancelled order from the
--    seller, one per rolling 7 days, capped recipients). Existing rows are
--    follower broadcasts.
-- Idempotent; touches no existing data.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE seller_push_broadcasts
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'followers';

CREATE INDEX IF NOT EXISTS seller_push_broadcasts_seller_audience_created_idx
  ON seller_push_broadcasts (seller_id, audience, created_at);

-- Past-buyer audience lookup: distinct buyers of one seller.
CREATE INDEX IF NOT EXISTS orders_owner_buyer_idx
  ON orders (owner_id, buyer_id) WHERE buyer_id IS NOT NULL;
