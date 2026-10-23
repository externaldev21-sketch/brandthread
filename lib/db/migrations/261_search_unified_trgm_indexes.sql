-- Unified search (GET /api/public/search/all — routes/search-unified.ts).
-- Idempotent. Plain CREATE INDEX (the runner wraps each file in a transaction,
-- so CONCURRENTLY is not available): each takes a brief write lock on its table.

-- Product search now matches descriptions as well as names (037 covers names).
CREATE INDEX IF NOT EXISTS products_description_trgm_idx
  ON products USING gin (description gin_trgm_ops);

-- Post search covers every media type, not only videos (112 is video-only).
CREATE INDEX IF NOT EXISTS posts_caption_trgm_idx
  ON posts USING gin (caption gin_trgm_ops);
