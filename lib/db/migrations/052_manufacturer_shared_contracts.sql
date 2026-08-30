CREATE TABLE IF NOT EXISTS manufacturer_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  manufacturer_id UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS rating_basis_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS response_time TEXT NOT NULL DEFAULT '';
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS application_request_id TEXT;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturers_application_request_id_unique
  ON manufacturers (application_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS manufacturer_relationships_seller_manufacturer_unique
  ON manufacturer_relationships (seller_id, manufacturer_id);
CREATE INDEX IF NOT EXISTS manufacturer_relationships_seller_idx
  ON manufacturer_relationships (seller_id);
CREATE INDEX IF NOT EXISTS manufacturer_relationships_manufacturer_idx
  ON manufacturer_relationships (manufacturer_id);

ALTER TABLE manufacturer_messages ADD COLUMN IF NOT EXISTS sender_clerk_id TEXT;
ALTER TABLE manufacturer_messages ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS manufacturer_messages_sender_request_unique
  ON manufacturer_messages (thread_id, sender_clerk_id, client_request_id);

ALTER TABLE sample_orders ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE sample_orders ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS sample_orders_seller_request_unique
  ON sample_orders (seller_id, client_request_id);