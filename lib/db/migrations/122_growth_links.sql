-- ─── Migration 122: Growth links (UTM tracked links, link-in-bio, store pixels)
-- Everything here is additive: new tables only. Orders are attributed to a link
-- through checkout_attributions (joined on the Stripe checkout session id) so
-- no existing orders / checkout_sessions column changes behaviour.
-- No raw IP address is ever stored: clicks keep a coarse country code and the
-- referrer HOST only.

CREATE TABLE IF NOT EXISTS tracked_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        TEXT NOT NULL,
  code             TEXT NOT NULL,
  label            TEXT NOT NULL DEFAULT '',
  destination_type TEXT NOT NULL,          -- store | product | bio
  destination_ref  TEXT,                   -- product id (null for store, bio)
  utm_source       TEXT,
  utm_medium       TEXT,
  utm_campaign     TEXT,
  utm_term         TEXT,
  utm_content      TEXT,
  archived_at      TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tracked_links_code_uidx ON tracked_links (code);
CREATE INDEX IF NOT EXISTS tracked_links_seller_idx ON tracked_links (seller_id, created_at);

CREATE TABLE IF NOT EXISTS link_clicks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id       UUID NOT NULL,
  seller_id     TEXT NOT NULL,
  country       TEXT,                      -- ISO-3166 alpha-2 from a CDN header, or null
  referrer_host TEXT,                      -- host only, never a full URL
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS link_clicks_link_idx ON link_clicks (link_id, created_at);
CREATE INDEX IF NOT EXISTS link_clicks_seller_idx ON link_clicks (seller_id, created_at);

CREATE TABLE IF NOT EXISTS checkout_attributions (
  checkout_session_id UUID PRIMARY KEY,
  stripe_session_id   TEXT,
  seller_id           TEXT NOT NULL,
  link_id             UUID,
  link_code           TEXT,
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS checkout_attributions_stripe_idx ON checkout_attributions (stripe_session_id);
CREATE INDEX IF NOT EXISTS checkout_attributions_link_idx ON checkout_attributions (link_id);
CREATE INDEX IF NOT EXISTS checkout_attributions_seller_idx ON checkout_attributions (seller_id);

CREATE TABLE IF NOT EXISTS bio_pages (
  seller_id              TEXT PRIMARY KEY,
  slug                   TEXT NOT NULL,
  display_name           TEXT NOT NULL DEFAULT '',
  bio                    TEXT NOT NULL DEFAULT '',
  avatar_url             TEXT,
  show_shop_button       BOOLEAN NOT NULL DEFAULT TRUE,
  shop_button_label      TEXT NOT NULL DEFAULT 'Shop my store',
  featured_product_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  socials                JSONB NOT NULL DEFAULT '{}'::jsonb,
  theme                  TEXT NOT NULL DEFAULT 'mono',   -- mono | dark
  accent_color           TEXT,                           -- optional #rrggbb
  published              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS bio_pages_slug_uidx ON bio_pages (slug);

CREATE TABLE IF NOT EXISTS bio_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  TEXT NOT NULL,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bio_links_seller_idx ON bio_links (seller_id, position);

-- One row per page view / link click on a bio page (bots are filtered before insert).
CREATE TABLE IF NOT EXISTS bio_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     TEXT NOT NULL,
  bio_link_id   UUID,                      -- null = page view; set = click on that link
  kind          TEXT NOT NULL,             -- view | click | shop | product
  ref           TEXT,                      -- product id for kind = product
  country       TEXT,
  referrer_host TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bio_events_seller_idx ON bio_events (seller_id, created_at);
CREATE INDEX IF NOT EXISTS bio_events_link_idx ON bio_events (bio_link_id);

CREATE TABLE IF NOT EXISTS store_pixels (
  seller_id       TEXT PRIMARY KEY,
  meta_pixel_id   TEXT,                    -- digits only, validated server-side
  tiktok_pixel_id TEXT,                    -- uppercase alphanumeric, validated server-side
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
