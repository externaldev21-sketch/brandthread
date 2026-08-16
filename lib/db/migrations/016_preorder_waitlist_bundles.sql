-- Migration 016: pre-order demand, waitlist, size charts, abandoned-cart tracking, bundles

-- ── Pre-order + size-chart fields on products ─────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_pre_order            BOOLEAN   NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS pre_order_closing_date  TIMESTAMP;
ALTER TABLE products ADD COLUMN IF NOT EXISTS pre_order_est_ship_date TIMESTAMP;
ALTER TABLE products ADD COLUMN IF NOT EXISTS drop_id                 UUID      REFERENCES drops(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_chart              JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS demand_count            INTEGER   NOT NULL DEFAULT 0;

-- ── Buyer pre-order reserves (no-charge demand signal) ───────────────────────
CREATE TABLE IF NOT EXISTS product_reserves (
    id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id     TEXT      NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, user_id)
);

-- ── Waitlist entries (out-of-stock variant interest) ──────────────────────────
CREATE TABLE IF NOT EXISTS waitlist_entries (
    id             UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     UUID      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id     UUID      REFERENCES product_variants(id) ON DELETE CASCADE,
    user_id        TEXT      NOT NULL,
    seller_id      TEXT      NOT NULL,
    product_name   TEXT      NOT NULL DEFAULT '',
    variant_label  TEXT      NOT NULL DEFAULT '',
    notified_at    TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, variant_id, user_id)
);

CREATE INDEX IF NOT EXISTS waitlist_entries_seller_id ON waitlist_entries (seller_id);
CREATE INDEX IF NOT EXISTS waitlist_entries_variant_id ON waitlist_entries (variant_id);

-- ── Product bundles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_bundles (
    id                  UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            TEXT      NOT NULL,
    name                TEXT      NOT NULL,
    description         TEXT,
    bundle_price_cents  INTEGER   NOT NULL DEFAULT 0,
    compare_at_cents    INTEGER   NOT NULL DEFAULT 0,  -- sum of individual prices for savings display
    status              TEXT      NOT NULL DEFAULT 'draft',   -- 'draft' | 'active'
    images              JSON      NOT NULL DEFAULT '[]',
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_bundles_owner_id ON product_bundles (owner_id);

CREATE TABLE IF NOT EXISTS bundle_items (
    id          UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id   UUID     NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
    product_id  UUID     NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id  UUID     REFERENCES product_variants(id) ON DELETE CASCADE,
    quantity    INTEGER  NOT NULL DEFAULT 1
);

-- ── Abandoned-cart tracking ───────────────────────────────────────────────────
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS notified_abandoned_at TIMESTAMP;
