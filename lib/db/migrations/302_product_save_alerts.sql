-- ─── Migration 302: saved-product alerts ─────────────────────────────────────
-- Back-in-stock / price-drop alerts for buyers who saved a product
-- (artifacts/api-server/src/lib/savedProductAlerts.ts).
--
--  * notify_on_back_in_stock   per-item opt-out, mirrors notify_on_price_drop.
--  * back_in_stock_notified_at per-saver cooldown so a product flapping
--                              between sold out and restocked doesn't spam.
--  * saved_items_product_target_idx  fan-out lookup "who saved product X".
--  * product_save_alert_runs   one row per alert fan-out, with how many buyers
--                              it reached — the seller's reach counts.
-- Idempotent.
ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS notify_on_back_in_stock BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE saved_items
  ADD COLUMN IF NOT EXISTS back_in_stock_notified_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS saved_items_product_target_idx
  ON saved_items (target_id)
  WHERE item_type = 'product';

CREATE TABLE IF NOT EXISTS product_save_alert_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL,
  owner_id         TEXT NOT NULL,
  kind             TEXT NOT NULL,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  price_cents      INTEGER,
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_save_alert_runs_product_idx
  ON product_save_alert_runs (product_id, kind, created_at);
