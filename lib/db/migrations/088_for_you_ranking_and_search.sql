-- Migration 088: For You ranking pipeline, event ingestion, and search upgrade.
-- All statements are idempotent (IF NOT EXISTS everywhere) per the repo's
-- migration convention.

-- ─── Live streams (bug fix) ─────────────────────────────────────────────────
-- routes/live.ts has always queried `live_streams` / `live_comments`, but no
-- prior migration ever created them — the entire Live Shopping feature has
-- been unusable in any real deployment (every query 500s on "relation does
-- not exist"). Creating them here both fixes that and unblocks the For You
-- feed's "mix in lives" requirement, which needs to read active streams.
CREATE TABLE IF NOT EXISTS live_streams (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id          TEXT NOT NULL,
  channel_name       TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'live', -- 'live' | 'ended'
  product_tags       JSONB NOT NULL DEFAULT '[]'::jsonb,
  agora_uid          INTEGER,
  thumbnail_url      TEXT,
  viewer_count       INTEGER NOT NULL DEFAULT 0,
  peak_viewer_count  INTEGER NOT NULL DEFAULT 0,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  replay_post_id     UUID REFERENCES posts(id) ON DELETE SET NULL,
  replay_url         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_streams_status_viewer_idx
  ON live_streams (status, viewer_count DESC, started_at ASC)
  WHERE status = 'live';
CREATE INDEX IF NOT EXISTS live_streams_seller_status_idx
  ON live_streams (seller_id, status);

CREATE TABLE IF NOT EXISTS live_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id    UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Viewer',
  avatar_url   TEXT,
  message      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_comments_stream_created_idx
  ON live_comments (stream_id, created_at DESC);

-- ─── Buyer style interests (bug fix) ────────────────────────────────────────
-- auth.ts and seller-profile.ts already write to users.buyer_style_interests
-- (seller-profile.ts even lazily ALTERs the column at request time). Formalize
-- it here as a real, idempotent migration and give it a shape usable for cold
-- start.
ALTER TABLE users ADD COLUMN IF NOT EXISTS buyer_style_interests JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── Event ingestion idempotency + hot-path indexes ─────────────────────────
-- Batched event ingestion (POST /api/feed/events) needs a per-user client-
-- supplied idempotency key so retried batches don't double-count signal.
ALTER TABLE interactions ADD COLUMN IF NOT EXISTS client_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS interactions_user_client_event_unique
  ON interactions (user_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- "What has this user already seen/done recently" (dedup for the ranking
-- pipeline, and the buyer's own interaction history) had no covering index —
-- only interactions_post_id_idx and interactions_post_type_idx existed.
CREATE INDEX IF NOT EXISTS interactions_user_created_idx
  ON interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interactions_user_type_created_idx
  ON interactions (user_id, type, created_at DESC);

-- ─── Posts hot-path indexes ──────────────────────────────────────────────────
-- The Threads feed's `WHERE user_id IN (...) AND <visible> ORDER BY created_at
-- DESC` and the For You / general feed's platform-wide "fresh uploads" scan
-- had no covering index.
CREATE INDEX IF NOT EXISTS posts_user_created_published_idx
  ON posts (user_id, created_at DESC)
  WHERE post_status = 'published';
CREATE INDEX IF NOT EXISTS posts_created_published_idx
  ON posts (created_at DESC)
  WHERE post_status = 'published';

-- Style-tag candidate generation filters posts by JSONB containment, which
-- needs jsonb (not json, what these columns were declared as) both for the
-- containment operators and for the jsonb_path_ops GIN opclass below.
ALTER TABLE posts ALTER COLUMN style_tags TYPE jsonb USING style_tags::jsonb;
ALTER TABLE products ALTER COLUMN style_tags TYPE jsonb USING style_tags::jsonb;

CREATE INDEX IF NOT EXISTS posts_style_tags_gin_idx
  ON posts USING GIN (style_tags jsonb_path_ops);
CREATE INDEX IF NOT EXISTS products_style_tags_gin_idx
  ON products USING GIN (style_tags jsonb_path_ops);

-- ─── Buyer taste profile ─────────────────────────────────────────────────────
-- Incrementally-updated per-user affinity vector, seeded from onboarding style
-- picks (cold start) and updated on every ingested behavioral event.
CREATE TABLE IF NOT EXISTS buyer_taste_profiles (
  user_id             TEXT PRIMARY KEY,
  category_affinity   JSONB NOT NULL DEFAULT '{}'::jsonb,
  style_tag_affinity  JSONB NOT NULL DEFAULT '{}'::jsonb,
  seller_affinity      JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_count         INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── For You feed cache ──────────────────────────────────────────────────────
-- Mirrors trending_cache / seller_ranking_cache's shape exactly, but one row
-- per user (short TTL, recomputed on demand) instead of one row per day —
-- keeps the response contract for GET /api/feed/for-you a cheap cache read on
-- repeat page requests, consistent with the codebase's established caching
-- idiom for ranked feeds.
CREATE TABLE IF NOT EXISTS for_you_feed_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL UNIQUE,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  results      JSONB NOT NULL DEFAULT '[]'::jsonb,
  item_count   INTEGER NOT NULL DEFAULT 0
);

-- ─── Search query log ────────────────────────────────────────────────────────
-- No search-query logging table existed (public.ts's /search/trending is
-- synthesized from product/follow counts, not real queries). This backs real
-- recent-searches (per user) and trending-searches (aggregate) endpoints.
CREATE TABLE IF NOT EXISTS search_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT,
  query         TEXT NOT NULL,
  normalized    TEXT NOT NULL,
  result_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_log_user_created_idx
  ON search_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS search_log_normalized_created_idx
  ON search_log (normalized, created_at DESC);

-- ─── Search: username on users (typo-tolerant search needs to match it) ────
-- users_username_trgm_idx already exists (migration 037); no new index
-- required here, this section intentionally left as documentation.
