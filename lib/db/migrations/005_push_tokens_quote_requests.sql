-- Migration 005: push_tokens + seller_quote_requests

-- Push notification tokens (one row per device/user pair)
CREATE TABLE IF NOT EXISTS push_tokens (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id);

-- Seller → manufacturer quote/sample requests
CREATE TABLE IF NOT EXISTS seller_quote_requests (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id       TEXT NOT NULL,
  manufacturer_id UUID NOT NULL REFERENCES manufacturers(id),
  request_type    TEXT NOT NULL DEFAULT 'quote',   -- quote | sample | production
  status          TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | viewed | quoted | accepted | declined | cancelled
  product_name    TEXT,
  description     TEXT,
  quantity        INTEGER,
  target_price_cents INTEGER,
  notes           TEXT,
  attachments     JSONB NOT NULL DEFAULT '[]',
  quoted_price_cents INTEGER,
  quoted_at       TIMESTAMPTZ,
  responded_notes TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seller_quote_requests_seller_idx  ON seller_quote_requests(seller_id);
CREATE INDEX IF NOT EXISTS seller_quote_requests_mfr_idx     ON seller_quote_requests(manufacturer_id);
