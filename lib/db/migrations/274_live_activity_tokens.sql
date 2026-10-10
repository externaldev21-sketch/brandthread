-- 274: iOS Live Activity push tokens.
-- One row per ActivityKit push token. kind 'order' = a buyer's order-tracking
-- activity (target_id = orders.id); kind 'live' = a seller's live-stream stats
-- activity (target_id = live_streams.id). The API pushes remote updates to
-- the active tokens for a target over APNs (lib/liveActivityPush.ts) and
-- deactivates a token when APNs reports it expired or unregistered.
CREATE TABLE IF NOT EXISTS live_activity_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CONSTRAINT live_activity_tokens_kind_check CHECK (kind IN ('order', 'live')),
  target_id  TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_activity_tokens_target_idx
  ON live_activity_tokens (kind, target_id) WHERE active;
