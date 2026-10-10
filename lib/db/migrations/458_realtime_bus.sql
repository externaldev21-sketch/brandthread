-- 458: Cross-instance realtime (BT-472, artifacts/api-server/src/lib/realtime).
--
-- realtime_bus_payloads: Postgres NOTIFY payloads must be under 8000 bytes.
-- A larger WebSocket event is stored here and only its id is notified; rows
-- are needed for seconds and are swept after 10 minutes.
--
-- realtime_presence: which user has a realtime room (community chat) open on
-- which API instance. Each instance heartbeats its rows; expired rows are
-- ignored on read and swept.
CREATE TABLE IF NOT EXISTS realtime_bus_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realtime_bus_payloads_created_at_idx
  ON realtime_bus_payloads (created_at);

CREATE TABLE IF NOT EXISTS realtime_presence (
  scope TEXT NOT NULL,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, room_id, user_id, instance_id)
);
CREATE INDEX IF NOT EXISTS realtime_presence_expires_at_idx
  ON realtime_presence (expires_at);
