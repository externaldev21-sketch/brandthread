-- Migration 091: 088_for_you_ranking_and_search.sql GIN-indexes
-- posts.style_tags and products.style_tags with jsonb_path_ops, but the
-- drizzle schema at the time still declared them as `json`, so a fresh
-- `drizzle-kit push` creates them as json and 088 fails on
-- "operator class jsonb_path_ops does not accept data type json". Same class
-- of drift 086_fresh_setup_schema_alignment.sql already fixes for other
-- columns — extend that pattern here rather than editing history.
-- Idempotent: safe to re-run.

DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE data_type = 'json'
      AND (table_name, column_name) IN (
        ('posts', 'style_tags'),
        ('products', 'style_tags')
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', col.table_name, col.column_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE jsonb USING %I::jsonb', col.table_name, col.column_name, col.column_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT ''[]''::jsonb', col.table_name, col.column_name);
  END LOOP;
END $$;
