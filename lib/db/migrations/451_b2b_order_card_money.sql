-- 451: B2B order-card money (Revenue P1: BT-452, BT-453, BT-454, BT-460, BT-461).
-- Fees on sample/bulk cards are fixed when Checkout opens or the drop wallet
-- pays; refunds, seller cancel requests and the accepted quote a card came
-- from are tracked on the order row. Additive only.
ALTER TABLE sample_orders
  ADD COLUMN IF NOT EXISTS processing_fee_estimate_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manufacturer_net_cents INTEGER,
  ADD COLUMN IF NOT EXISTS payment_method_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee_refunded_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancel_request_state TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS cancel_request_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS quote_request_id UUID;

-- One payable card per accepted quote, however often the accept is retried.
CREATE UNIQUE INDEX IF NOT EXISTS sample_orders_quote_request_unique
  ON sample_orders (quote_request_id);
