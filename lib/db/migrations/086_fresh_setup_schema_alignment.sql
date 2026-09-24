-- Migration 086: align existing databases with the drizzle schema changes that
-- make a fresh `pnpm run setup` (drizzle push + migrations) apply cleanly.
-- Idempotent: safe to re-run.

-- 1. design_studio_projects(id, owner_id) is now a UNIQUE constraint rather
--    than a bare unique index. drizzle-kit creates foreign keys before indexes,
--    so the composite FK from design_studio_assets needs a constraint that
--    exists at CREATE TABLE time. Promote the index made by 069-071 in place;
--    the FK that depends on it stays valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_studio_projects_id_owner_unique'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_class WHERE relname = 'design_studio_projects_id_owner_unique' AND relkind = 'i'
    ) THEN
      ALTER TABLE design_studio_projects
        ADD CONSTRAINT design_studio_projects_id_owner_unique
        UNIQUE USING INDEX design_studio_projects_id_owner_unique;
    ELSE
      ALTER TABLE design_studio_projects
        ADD CONSTRAINT design_studio_projects_id_owner_unique UNIQUE (id, owner_id);
    END IF;
  END IF;
END $$;

-- 2. Columns that 077/078 define (and GIN-index) as jsonb but the drizzle
--    schema declared as json. Convert any database where a push created json.
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE data_type = 'json'
      AND (table_name, column_name) IN (
        ('posts', 'media_paths'),
        ('posts', 'slide_overlays'),
        ('ad_campaigns', 'media_object_paths'),
        ('ad_campaigns', 'media_mime_types'),
        ('ad_campaigns', 'formats')
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', col.table_name, col.column_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE jsonb USING %I::jsonb', col.table_name, col.column_name, col.column_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT ''[]''::jsonb', col.table_name, col.column_name);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS posts_media_paths_idx ON posts USING GIN (media_paths);
CREATE INDEX IF NOT EXISTS ad_campaigns_media_paths_gin_idx
  ON ad_campaigns USING GIN (media_object_paths);
