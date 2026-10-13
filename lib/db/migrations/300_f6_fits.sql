-- 300 (F6 fits): stitches, buyer fit checks, brand repost requests.
-- Side tables keyed off posts; nothing is added to the posts row.

CREATE TABLE IF NOT EXISTS post_stitches (
  post_id          UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  source_post_id   UUID REFERENCES posts(id) ON DELETE SET NULL,
  source_author_id TEXT NOT NULL,
  clip_start_ms    INTEGER NOT NULL DEFAULT 0,
  clip_end_ms      INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS post_stitches_source_idx ON post_stitches (source_post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_fit_checks (
  post_id    UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  buyer_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS post_fit_checks_product_idx ON post_fit_checks (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS post_fit_checks_buyer_idx ON post_fit_checks (buyer_id);

CREATE TABLE IF NOT EXISTS repost_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id             UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  requester_seller_id TEXT NOT NULL,
  owner_user_id       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS repost_requests_owner_idx ON repost_requests (owner_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS repost_requests_post_seller_idx ON repost_requests (post_id, requester_seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS repost_requests_open_unique
  ON repost_requests (post_id, requester_seller_id) WHERE status = 'pending';
