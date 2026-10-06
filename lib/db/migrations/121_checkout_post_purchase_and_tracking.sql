-- ─── Migration 121: Post-purchase offer + conversion tracking ─────────────
-- Seller Checkout settings (mobile app/checkout.tsx):
--  • "Post-purchase features": one offer shown on the buyer's order
--    confirmation right after checkout (Shopify post-purchase pattern).
--    "Add to order" charges the card from the original payment and makes a
--    real follow-up order linked by upsell_of_order_id
--    (api-server lib/postPurchaseOffer.ts).
--  • "Additional scripts": the store's conversion tracking. Pixel /
--    measurement IDs and server API secrets for Meta, TikTok and Google
--    Analytics 4; secrets are AES-256-GCM encrypted (lib/metaCrypto.ts) and
--    never returned in full. On a paid order the API sends one Purchase
--    event per configured provider (lib/conversionTracking.ts), recorded in
--    conversion_event_deliveries so each order is sent at most once.

CREATE TABLE IF NOT EXISTS seller_post_purchase_offers (
  seller_id         TEXT PRIMARY KEY,
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  product_id        UUID,
  discount_percent  INTEGER NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 50),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_conversion_tracking (
  seller_id                   TEXT PRIMARY KEY,
  meta_pixel_id               TEXT,
  meta_access_token_enc       TEXT,
  tiktok_pixel_id             TEXT,
  tiktok_access_token_enc     TEXT,
  ga4_measurement_id          TEXT,
  ga4_api_secret_enc          TEXT,
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversion_event_deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL,
  seller_id     TEXT NOT NULL,
  provider      TEXT NOT NULL,          -- 'meta' | 'tiktok' | 'ga4'
  status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  sent_at       TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversion_event_deliveries_order_provider_uq
  ON conversion_event_deliveries (order_id, provider);
CREATE INDEX IF NOT EXISTS conversion_event_deliveries_seller_idx
  ON conversion_event_deliveries (seller_id, created_at);

-- The follow-up order an accepted post-purchase offer made, and the checkout
-- row that paid for it.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS upsell_of_order_id UUID;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS upsell_of_order_id UUID;
CREATE INDEX IF NOT EXISTS orders_upsell_of_order_idx
  ON orders (upsell_of_order_id) WHERE upsell_of_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS checkout_sessions_upsell_of_order_idx
  ON checkout_sessions (upsell_of_order_id) WHERE upsell_of_order_id IS NOT NULL;
