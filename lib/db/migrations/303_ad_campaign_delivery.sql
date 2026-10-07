-- ─── Migration 303: ad campaign delivery ──────────────────────────────────────
-- Paid ad campaigns (078/079) are now actually delivered into buyer feeds
-- (Following / For You / Discover). Adds spend + counters + pause/complete
-- lifecycle to ad_campaigns, and the per-serve / per-click ledgers that the
-- frequency caps, CPM billing and seller results read from.
--
-- ad_campaigns.status gains two values (TEXT column, no CHECK):
--   'paused'    — seller paused; resumable while budget remains and before ends_at
--   'completed' — terminal; completion_reason = budget_spent | ended | seller_stopped
--
-- Idempotent: safe to rerun, and safe after drizzle push already created the
-- same shape (constraint/index names match lib/db/src/schema/index.ts).

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS spent_cents        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impressions_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_reason  TEXT,
  ADD COLUMN IF NOT EXISTS surfaces           JSONB NOT NULL DEFAULT '["following","for_you","discover"]'::jsonb;

-- Serving + the ends_at sweep filter on status first.
CREATE INDEX IF NOT EXISTS ad_campaigns_status_ends_idx
  ON ad_campaigns (status, ends_at);

-- One row per ad served into a feed. serve_token is the one-time token the
-- client confirms a viewable impression with; viewed_at set = billed.
CREATE TABLE IF NOT EXISTS ad_impressions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  seller_id     TEXT NOT NULL,
  viewer_id     TEXT NOT NULL,
  surface       TEXT NOT NULL,              -- 'following' | 'for_you' | 'discover'
  session_id    TEXT NOT NULL,
  serve_token   TEXT NOT NULL,
  cost_cents    INTEGER NOT NULL,           -- quoted per-impression price
  billed_cents  INTEGER NOT NULL DEFAULT 0, -- 0 until the impression is confirmed
  served_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at     TIMESTAMPTZ,
  CONSTRAINT ad_impressions_serve_token_unique UNIQUE (serve_token)
);

-- A campaign never repeats within a viewer's session (race-safe).
CREATE UNIQUE INDEX IF NOT EXISTS ad_impressions_campaign_viewer_session_unique
  ON ad_impressions (campaign_id, viewer_id, session_id);
-- Per-viewer rolling-24h frequency cap.
CREATE INDEX IF NOT EXISTS ad_impressions_viewer_served_idx
  ON ad_impressions (viewer_id, served_at);
-- Per-campaign rollups (results, daily series, unique reach).
CREATE INDEX IF NOT EXISTS ad_impressions_campaign_viewed_idx
  ON ad_impressions (campaign_id, viewed_at);

-- One click per impression.
CREATE TABLE IF NOT EXISTS ad_clicks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  impression_id  UUID NOT NULL REFERENCES ad_impressions(id) ON DELETE CASCADE,
  viewer_id      TEXT NOT NULL,
  surface        TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ad_clicks_impression_id_unique UNIQUE (impression_id)
);

CREATE INDEX IF NOT EXISTS ad_clicks_campaign_created_idx
  ON ad_clicks (campaign_id, created_at);
CREATE INDEX IF NOT EXISTS ad_clicks_viewer_created_idx
  ON ad_clicks (viewer_id, created_at);
