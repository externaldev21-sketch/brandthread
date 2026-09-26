-- 088: Shopify fulfillment bridge. Two independent capabilities on one
-- connection row per seller:
--   (A) Product transfer — read-only catalog import (read_products,
--       read_inventory). Never forwards orders.
--   (B) Fulfillment via Shopify — opt-in order forwarding + tracking sync,
--       requires the connection to be upgraded with order-write scopes.
-- Not a money-path change: order release on tracking reuses the existing
-- requestOrderRelease()/executeOrderRelease() escrow path unmodified.

CREATE TABLE IF NOT EXISTS shopify_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             TEXT NOT NULL UNIQUE,
  shop_domain          TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  connection_type      TEXT NOT NULL DEFAULT 'oauth',
  scopes               TEXT NOT NULL DEFAULT '',
  fulfillment_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  status               TEXT NOT NULL DEFAULT 'connected',
  last_error           TEXT,
  last_import_at       TIMESTAMPTZ,
  last_order_sync_at   TIMESTAMPTZ,
  connected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopify_oauth_states (
  state        TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  shop_domain  TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS shopify_product_links (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                TEXT NOT NULL,
  shopify_product_id      TEXT NOT NULL,
  brandthread_product_id  UUID NOT NULL,
  variant_map             JSONB NOT NULL DEFAULT '{}',
  last_imported_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS shopify_product_links_owner_product_unique ON shopify_product_links (owner_id, shopify_product_id);
CREATE INDEX IF NOT EXISTS shopify_product_links_bt_product_idx ON shopify_product_links (brandthread_product_id);

CREATE TABLE IF NOT EXISTS shopify_order_links (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brandthread_order_id   UUID NOT NULL UNIQUE,
  owner_id               TEXT NOT NULL,
  shopify_order_id       TEXT,
  shopify_order_name     TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending',
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shopify_order_links_shopify_order_idx ON shopify_order_links (shopify_order_id);

CREATE TABLE IF NOT EXISTS shopify_webhook_events (
  id           TEXT PRIMARY KEY, -- "<shop-domain>:<X-Shopify-Webhook-Id>"
  shop_domain  TEXT NOT NULL,
  topic        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
