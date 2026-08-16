-- Migration 008: bio link on profiles, drop countdowns, shoppable post tagging, content reports

-- Website / bio link on user profiles
ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;

-- Release-at countdown for buyer-facing drops
ALTER TABLE drops ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;

-- Shoppable post tagging — seller tags their own products onto posts
CREATE TABLE IF NOT EXISTS post_tagged_products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, product_id)
);
CREATE INDEX IF NOT EXISTS ptp_post_id_idx    ON post_tagged_products(post_id);
CREATE INDEX IF NOT EXISTS ptp_product_id_idx ON post_tagged_products(product_id);

-- User content reports
CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  TEXT NOT NULL,
  target_type  TEXT NOT NULL,   -- 'post'|'product'|'profile'|'story'|'message'|'seller'
  target_id    TEXT NOT NULL,
  target_label TEXT,
  reason       TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'reviewed'|'actioned'|'dismissed'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_target_idx ON reports(target_type, target_id);
