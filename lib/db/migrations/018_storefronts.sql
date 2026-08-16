-- Migration 018: Storefronts, versions, custom domains
CREATE TABLE IF NOT EXISTS storefronts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT NOT NULL UNIQUE,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL DEFAULT '',
  subtitle        TEXT,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  theme           JSONB NOT NULL DEFAULT '{}',
  branding        JSONB NOT NULL DEFAULT '{}',
  sections        JSONB NOT NULL DEFAULT '[]',
  seo             JSONB NOT NULL DEFAULT '{}',
  social_links    JSONB NOT NULL DEFAULT '{}',
  analytics_code  TEXT,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storefront_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id   UUID NOT NULL REFERENCES storefronts(id) ON DELETE CASCADE,
  label           TEXT NOT NULL DEFAULT '',
  snapshot        JSONB NOT NULL DEFAULT '{}',
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storefront_custom_domains (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storefront_id   UUID NOT NULL REFERENCES storefronts(id) ON DELETE CASCADE,
  domain          TEXT NOT NULL UNIQUE,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  verify_token    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
