CREATE TABLE IF NOT EXISTS shipping_label_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  provider_shipment_id TEXT NOT NULL,
  provider_rate_id TEXT NOT NULL,
  carrier TEXT NOT NULL,
  service TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipping_label_quotes_order_idx ON shipping_label_quotes(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS shipping_label_quotes_rate_unique
  ON shipping_label_quotes(owner_id, provider_rate_id);