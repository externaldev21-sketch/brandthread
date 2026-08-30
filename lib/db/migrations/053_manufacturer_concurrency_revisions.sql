-- Revision tokens are integer-based so JSON's millisecond timestamps are never
-- compared to PostgreSQL's microsecond timestamp values.
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sample_orders ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

-- Explicitly repair any rows created during a partially applied deployment.
UPDATE manufacturers SET revision = 1 WHERE revision IS NULL;
UPDATE sample_orders SET revision = 1 WHERE revision IS NULL;