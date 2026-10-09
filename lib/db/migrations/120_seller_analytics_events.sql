-- ─── Migration 120: Seller analytics insights ────────────────────────────────
-- seller_product_events: server-side funnel events (add_to_cart) recorded from
--   the buyer cart sync path. Product views already live in store_visits
--   (migration 108, product_id set) and are NOT duplicated here. viewer_key is
--   a salted SHA-256 (per seller), never a raw user id.
-- seller_goals: one monthly revenue-or-orders target per seller.
-- Both tables are pruned by the analyticsRetention job (400 days for events).

CREATE TABLE IF NOT EXISTS seller_product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  product_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  viewer_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seller_product_events_seller_created_idx
  ON seller_product_events (seller_id, created_at);
CREATE INDEX IF NOT EXISTS seller_product_events_seller_product_idx
  ON seller_product_events (seller_id, product_id, created_at);
CREATE INDEX IF NOT EXISTS seller_product_events_created_idx
  ON seller_product_events (created_at);

CREATE TABLE IF NOT EXISTS seller_goals (
  seller_id TEXT PRIMARY KEY,
  metric TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_goals_metric_check CHECK (metric IN ('revenue', 'orders')),
  CONSTRAINT seller_goals_target_check CHECK (target_value > 0)
);
