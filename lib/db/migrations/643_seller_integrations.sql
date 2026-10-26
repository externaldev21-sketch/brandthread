-- 643: seller_integrations backs Settings → Integrations (GET/POST/DELETE
-- /api/seller/settings/integrations, routes/seller-settings-route.ts). The
-- routes shipped without the table, so the screen's load always failed.
CREATE TABLE IF NOT EXISTS seller_integrations (
  owner_id     TEXT NOT NULL,
  key          TEXT NOT NULL,
  settings     JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, key)
);
