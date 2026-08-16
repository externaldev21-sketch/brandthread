-- ─── 014 Ecommerce features ───────────────────────────────────────────────────
-- Adds: discount_codes, returns, shipping_rates tables
--       + orders columns for fulfillment timestamps, discount tracking,
--         post-click attribution, and source_post_id.

-- ── Discount codes ────────────────────────────────────────────────────────────
CREATE TABLE discount_codes (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id      TEXT        NOT NULL,                    -- Clerk user ID of owning seller
  code           TEXT        NOT NULL,                    -- Buyer-entered code (stored upper-case)
  type           TEXT        NOT NULL DEFAULT 'percentage', -- 'percentage' | 'fixed' | 'free_shipping'
  value          NUMERIC(10,2) NOT NULL DEFAULT 0,        -- % (0-100) or cents for fixed
  min_order_cents INTEGER    NOT NULL DEFAULT 0,          -- Minimum subtotal to qualify (cents)
  max_uses       INTEGER,                                 -- NULL = unlimited
  uses_count     INTEGER     NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ,                             -- NULL = never expires
  active         BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, code)
);
CREATE INDEX discount_codes_seller_idx ON discount_codes (seller_id);
CREATE INDEX discount_codes_code_idx   ON discount_codes (code);

-- ── Order fulfillment timestamps + discount + attribution ─────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_at           TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_at          TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code       TEXT;        -- Applied code (denormalized for history)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_post_id      TEXT;        -- Post/video that drove the Shop click

-- ── Returns ───────────────────────────────────────────────────────────────────
CREATE TABLE returns (
  id                    TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id              UUID        NOT NULL REFERENCES orders (id),
  buyer_id              TEXT        NOT NULL,              -- Clerk user ID
  seller_id             TEXT        NOT NULL,              -- Clerk user ID
  reason                TEXT        NOT NULL,
  notes                 TEXT,
  resolution_requested  TEXT        NOT NULL DEFAULT 'refund', -- 'refund' | 'exchange' | 'store_credit' | 'replacement'
  status                TEXT        NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied' | 'refunded'
  stripe_refund_id      TEXT,                              -- Set after Stripe refund issued
  refund_amount_cents   INTEGER,
  seller_response       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX returns_order_idx  ON returns (order_id);
CREATE INDEX returns_seller_idx ON returns (seller_id);
CREATE INDEX returns_buyer_idx  ON returns (buyer_id);

-- ── Shipping rates ────────────────────────────────────────────────────────────
-- One row per rate rule per seller.  applies_to='storewide' means it applies to
-- every order; 'product' means only when product_id is in the cart.
CREATE TABLE shipping_rates (
  id               TEXT     PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seller_id        TEXT     NOT NULL,
  name             TEXT     NOT NULL DEFAULT 'Standard Shipping',
  flat_rate_cents  INTEGER  NOT NULL DEFAULT 0,  -- 0 = free
  free_above_cents INTEGER,                       -- NULL = never auto-free; 0 = always free
  active           BOOLEAN  NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipping_rates_seller_idx ON shipping_rates (seller_id);
