-- Final moderation removals must never be converted back into seller recovery
-- deletes. Nullable preserves historic rows without guessing their provenance.
ALTER TABLE products ADD COLUMN IF NOT EXISTS removal_kind text;
CREATE INDEX IF NOT EXISTS products_removal_kind_idx ON products (removal_kind) WHERE removal_kind IS NOT NULL;