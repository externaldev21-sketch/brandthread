-- ─── Migration 110: Delivery guarantee ───────────────────────────────────────
-- Per-order and per-item delivery deadlines (15 days regular, 60 days
-- pre-order from purchase), carrier-confirmed delivery, the auto-refund job's
-- retry state, dispute pause, and the hold-until-delivered payout release
-- time. Additive and idempotent. Orders created before this migration have
-- deliver_by NULL and keep their old behaviour (no auto-refund, old payout).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deliver_by                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_preorder                  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS promised_ship_date           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_by        TEXT,
  ADD COLUMN IF NOT EXISTS payout_release_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_paused_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_refunded_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_refund_attempts         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_refund_next_attempt_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_refund_last_error       TEXT,
  ADD COLUMN IF NOT EXISTS deadline_warning_level       SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracking_polled_at           TIMESTAMPTZ;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_confirmed_by_valid;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_confirmed_by_valid CHECK (
  delivery_confirmed_by IS NULL OR delivery_confirmed_by IN ('carrier', 'buyer')
);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS is_preorder      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deliver_by       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_number  TEXT,
  ADD COLUMN IF NOT EXISTS carrier          TEXT,
  ADD COLUMN IF NOT EXISTS tracking_status  TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_cents   INTEGER NOT NULL DEFAULT 0;

-- The auto-refund sweep and the warning sweep scan only live, undelivered,
-- deadline-bearing orders.
CREATE INDEX IF NOT EXISTS orders_deliver_by_open_idx
  ON orders (deliver_by)
  WHERE deliver_by IS NOT NULL AND delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_payout_release_idx
  ON orders (payout_release_at)
  WHERE payout_release_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_items_tracking_number_idx
  ON order_items (tracking_number)
  WHERE tracking_number IS NOT NULL;

-- Carrier scan history, shown to the buyer as "live tracking events".
CREATE TABLE IF NOT EXISTS order_tracking_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tracking_number  TEXT NOT NULL,
  status           TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  location         TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_tracking_events_unique UNIQUE (order_id, tracking_number, status, occurred_at)
);
CREATE INDEX IF NOT EXISTS order_tracking_events_order_idx
  ON order_tracking_events (order_id, occurred_at DESC);

-- Pre-order products must carry the seller's promised ship date.
-- (Enforced in the API for new listings; the column already exists.)
