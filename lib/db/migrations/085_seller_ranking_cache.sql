-- ─── Migration 085: Seller Ranking Cache (Discover feed) ────────────────────
-- Stores the pre-computed daily seller ranking so the
-- GET /api/public/discover/feed endpoint is a simple cache read rather than
-- an expensive live aggregation. One row per calendar day (UTC). Upserted by
-- the computeSellerRanking job. Shape mirrors trending_cache exactly.

CREATE TABLE IF NOT EXISTS seller_ranking_cache (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cache_date   TEXT        NOT NULL,       -- 'YYYY-MM-DD' (UTC)
  results      JSONB       NOT NULL DEFAULT '[]',
  item_count   INTEGER     NOT NULL DEFAULT 0,
  UNIQUE(cache_date)
);
CREATE INDEX IF NOT EXISTS seller_ranking_cache_date_idx ON seller_ranking_cache(cache_date);
