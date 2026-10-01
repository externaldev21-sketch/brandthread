-- ─── Migration 230: native in-app purchases for Boost / Create-ad ─────────────
-- App Store Guideline 3.1.1: paid promotion bought inside the iOS/Android app
-- is a digital good and is sold through RevenueCat consumable products. One
-- row per store transaction makes the grant idempotent (webhook + client
-- verify can both race on the same purchase).

CREATE TABLE IF NOT EXISTS iap_promotion_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL,
  app_user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'boost' | 'ad_campaign'
  amount_cents INTEGER NOT NULL,   -- budget the product buys
  target_id TEXT,                  -- boost / campaign id once granted
  granted_at TIMESTAMPTZ,
  source TEXT NOT NULL,            -- 'webhook' | 'client_verify'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS iap_promotion_purchases_transaction_unique
  ON iap_promotion_purchases (transaction_id);

CREATE INDEX IF NOT EXISTS iap_promotion_purchases_user_idx
  ON iap_promotion_purchases (app_user_id, created_at);
