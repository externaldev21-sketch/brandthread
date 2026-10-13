-- 531: App installs, for the admin install → sign-up → first purchase funnel.
-- One row per app install: a random install id the app generates on first
-- launch (no device identifiers). clerk_id is filled in once that install signs
-- in to an account. Nothing else about the device is stored.
CREATE TABLE IF NOT EXISTS app_installs (
  install_id     TEXT PRIMARY KEY,
  platform       TEXT NOT NULL DEFAULT 'unknown',
  app_version    TEXT,
  clerk_id       TEXT,
  first_seen_at  TIMESTAMP NOT NULL DEFAULT now(),
  signed_in_at   TIMESTAMP
);
CREATE INDEX IF NOT EXISTS app_installs_first_seen_idx ON app_installs (first_seen_at);
CREATE INDEX IF NOT EXISTS app_installs_clerk_idx ON app_installs (clerk_id);
