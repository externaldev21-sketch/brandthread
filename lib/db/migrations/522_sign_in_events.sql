-- New-device sign-in alerts (feature 74): one row per Clerk session the first
-- time the app syncs on it. A device kind the account hasn't used before
-- triggers an alert (push + email + Activity row).
CREATE TABLE IF NOT EXISTS sign_in_events (
  session_id   text        PRIMARY KEY,
  user_id      text        NOT NULL,
  device_key   text        NOT NULL,
  device_label text        NOT NULL,
  location     text,
  alerted      integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_events_user_idx ON sign_in_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS sign_in_events_user_device_idx ON sign_in_events (user_id, device_key);
