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

CREATE TABLE IF NOT EXISTS shipping_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'shippo',
  provider_shipment_id TEXT,
  provider_transaction_id TEXT,
  provider_rate_id TEXT NOT NULL,
  carrier TEXT,
  service TEXT,
  tracking_number TEXT,
  label_url TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  status TEXT NOT NULL DEFAULT 'purchasing',
  failure_reason TEXT,
  previous_order_status TEXT,
  refunded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipping_labels_order_idx ON shipping_labels(order_id);
CREATE INDEX IF NOT EXISTS shipping_labels_owner_idx ON shipping_labels(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS shipping_labels_owner_idempotency_unique
  ON shipping_labels(owner_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS shipping_labels_one_open_per_order
  ON shipping_labels(order_id)
  WHERE status IN ('purchasing', 'active', 'void_pending');

CREATE TABLE IF NOT EXISTS order_fund_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  shipping_label_id UUID NOT NULL REFERENCES shipping_labels(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'reserved',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_fund_reservations_order_idx ON order_fund_reservations(order_id);
CREATE INDEX IF NOT EXISTS order_fund_reservations_owner_idx ON order_fund_reservations(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS order_fund_reservations_label_unique
  ON order_fund_reservations(shipping_label_id);