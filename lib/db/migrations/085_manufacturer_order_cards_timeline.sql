-- Migration 085: manufacturer-issued order cards, tracker timeline, time zones.
-- Idempotent: safe to re-run.

ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS time_zone TEXT;

ALTER TABLE sample_orders ADD COLUMN IF NOT EXISTS issued_by TEXT NOT NULL DEFAULT 'seller';

CREATE TABLE IF NOT EXISTS manufacturer_order_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_order_id  UUID NOT NULL REFERENCES sample_orders(id) ON DELETE CASCADE,
  manufacturer_id  UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  actor_clerk_id   TEXT,
  actor_role       TEXT NOT NULL,
  from_status      TEXT,
  to_status        TEXT NOT NULL,
  carrier          TEXT,
  tracking_number  TEXT,
  note             TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manufacturer_order_events_order_created_idx
  ON manufacturer_order_events (sample_order_id, created_at);
CREATE INDEX IF NOT EXISTS manufacturer_order_events_manufacturer_idx
  ON manufacturer_order_events (manufacturer_id);

-- Directory filters sort and filter on these columns.
CREATE INDEX IF NOT EXISTS manufacturers_public_directory_idx
  ON manufacturers (status, is_public_directory, years_in_business);

-- Backfill: shipped/delivered timestamps already recorded on the order become
-- timeline events so older orders show real times instead of blanks.
INSERT INTO manufacturer_order_events (sample_order_id, manufacturer_id, actor_role, to_status, carrier, tracking_number, created_at)
SELECT id, manufacturer_id, 'manufacturer', 'shipped', carrier, tracking_number, shipped_at
FROM sample_orders o
WHERE shipped_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM manufacturers m WHERE m.id = o.manufacturer_id)
  AND NOT EXISTS (SELECT 1 FROM manufacturer_order_events e WHERE e.sample_order_id = o.id AND e.to_status = 'shipped');

INSERT INTO manufacturer_order_events (sample_order_id, manufacturer_id, actor_role, to_status, created_at)
SELECT id, manufacturer_id, 'manufacturer', 'delivered', delivered_at
FROM sample_orders o
WHERE delivered_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM manufacturers m WHERE m.id = o.manufacturer_id)
  AND NOT EXISTS (SELECT 1 FROM manufacturer_order_events e WHERE e.sample_order_id = o.id AND e.to_status = 'delivered');
