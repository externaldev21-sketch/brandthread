-- Migration 270: server-side Brandthread subdomains (<slug>.brandthread.app).
-- The storefront slug is the subdomain; subdomain_claimed_at marks a slug the
-- seller claimed (vs. the auto-assigned store-xxxxxxxx one). Subdomains are
-- case-insensitive, so uniqueness is enforced on lower(slug). The claim
-- endpoint also checks case-insensitively, so if existing rows already hold
-- case-only duplicates the index is skipped instead of failing the migration.
ALTER TABLE storefronts
  ADD COLUMN IF NOT EXISTS subdomain_claimed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storefronts GROUP BY lower(slug) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS storefronts_slug_lower_unique
      ON storefronts (lower(slug));
  END IF;
END $$;
