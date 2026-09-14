-- Optional closing time for buyer-facing, time-limited drops.
-- IF NOT EXISTS keeps this migration safe for databases provisioned from a
-- schema that already contains the column.
ALTER TABLE drops
  ADD COLUMN IF NOT EXISTS ends_at timestamptz;