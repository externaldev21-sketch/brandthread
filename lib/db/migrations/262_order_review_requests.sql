-- 262: Post-delivery review request (one per order).
-- A row is inserted before the review request push/email goes out, so a
-- re-run of the job, or the same job on another server instance, can never ask
-- the same buyer twice for the same order (the primary key is the claim).
CREATE TABLE IF NOT EXISTS order_review_requests (
  order_id   UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  buyer_id   TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS order_review_requests_buyer_idx ON order_review_requests(buyer_id);
