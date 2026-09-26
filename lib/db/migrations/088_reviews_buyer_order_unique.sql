-- 088: Enforce one review per (buyer, order).
--
-- POST /api/reviews relies on a unique-violation catch to update an existing
-- review idempotently instead of creating a duplicate, but no such
-- constraint existed — so resubmitting a review for the same order created
-- a second row instead of updating the first. Not a payout-path change.

-- Collapse any pre-existing duplicates first, keeping the most recently
-- updated review per (buyer, order).
DELETE FROM reviews r
WHERE r.order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM reviews newer
    WHERE newer.buyer_id = r.buyer_id
      AND newer.order_id = r.order_id
      AND (newer.updated_at, newer.id) > (r.updated_at, r.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS reviews_buyer_order_unique
  ON reviews (buyer_id, order_id)
  WHERE order_id IS NOT NULL;
