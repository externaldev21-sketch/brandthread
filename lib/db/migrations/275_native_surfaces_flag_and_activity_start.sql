-- 275: iOS native surfaces (Live Activities, widgets, Watch sale ping).
--
-- 1. One feature flag for every native surface, seeded OFF. Dev turns it on
--    with PUT /api/feature-flags/nativeSurfaces once a dev-client / TestFlight
--    build with the extensions is out. The server and the app both read it.
-- 2. ActivityKit push-to-start tokens (iOS 17.2+), one per device. The server
--    uses them to start a fresh order-tracking Live Activity when an order
--    ships or goes out for delivery after the earlier one has expired
--    (ActivityKit ends an activity after 8 hours).
-- 3. live_activity_remote_starts: at most one remote start per order and
--    stage, so a webhook retry can never start a second activity.
INSERT INTO feature_flags (key, enabled, description)
VALUES ('nativeSurfaces', false, 'iOS Live Activities, Home/Lock Screen widgets and the Watch sale ping. Needs a dev-client or TestFlight build.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS live_activity_start_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_activity_start_tokens_user_idx
  ON live_activity_start_tokens (user_id) WHERE active;

CREATE TABLE IF NOT EXISTS live_activity_remote_starts (
  order_id   TEXT NOT NULL,
  stage      TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, stage)
);
