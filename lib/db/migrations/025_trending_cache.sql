-- ─── Migration 025: Trending Cache ───────────────────────────────────────────
-- Stores the pre-computed daily trending list so the /api/public/trending
-- endpoint is a simple cache read rather than an expensive live aggregation.
-- One row per calendar day (UTC). Upserted by the computeTrending job.

CREATE TABLE IF NOT EXISTS trending_cache (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cache_date   TEXT        NOT NULL,       -- 'YYYY-MM-DD' (UTC)
  results      JSONB       NOT NULL DEFAULT '[]',
  item_count   INTEGER     NOT NULL DEFAULT 0,
  UNIQUE(cache_date)
);
CREATE INDEX IF NOT EXISTS trending_cache_date_idx ON trending_cache(cache_date);
