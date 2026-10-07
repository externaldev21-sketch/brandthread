-- ─── Migration 304: Live purchase attribution + live summary ─────────────────
-- orders.source_live_stream_id / checkout_sessions.source_live_stream_id:
--   the live stream a purchase was made from. Written only after the server
--   checked the stream belongs to that order's seller (host or accepted
--   co-host) and the payment landed while live or within the grace window
--   (api-server lib/liveAttribution.ts). Nullable, no FK: a deleted stream
--   never blocks or rewrites an order.
-- live_stream_unique_viewers: everyone ever present in a live, for the
--   seller's live summary. live_viewers only holds who is watching now (rows
--   go on leave and on end), so a trigger copies each first presence here.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_live_stream_id UUID;
CREATE INDEX IF NOT EXISTS orders_source_live_stream_idx
  ON orders (source_live_stream_id) WHERE source_live_stream_id IS NOT NULL;

ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS source_live_stream_id UUID;

CREATE TABLE IF NOT EXISTS live_stream_unique_viewers (
  stream_id     UUID NOT NULL REFERENCES live_streams(id) ON DELETE CASCADE,
  viewer_id     TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, viewer_id)
);

CREATE OR REPLACE FUNCTION live_viewers_record_unique() RETURNS trigger AS $$
BEGIN
  INSERT INTO live_stream_unique_viewers (stream_id, viewer_id)
  VALUES (NEW.stream_id, NEW.user_id_or_session_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS live_viewers_record_unique_trg ON live_viewers;
CREATE TRIGGER live_viewers_record_unique_trg
  AFTER INSERT ON live_viewers
  FOR EACH ROW EXECUTE FUNCTION live_viewers_record_unique();

-- Existing presence rows (lives in progress when this ships) count too.
INSERT INTO live_stream_unique_viewers (stream_id, viewer_id, first_seen_at)
SELECT stream_id, user_id_or_session_id, last_seen FROM live_viewers
ON CONFLICT DO NOTHING;
