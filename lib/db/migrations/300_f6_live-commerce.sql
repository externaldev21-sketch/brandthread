-- F6 live-commerce: live order attribution, co-host bag, live gift platform fee.
CREATE TABLE IF NOT EXISTS live_stream_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id uuid NOT NULL,
  stream_id           uuid NOT NULL,
  buyer_id            text NOT NULL,
  seller_id           text NOT NULL,
  order_id            uuid,
  announced_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_stream_orders_checkout_unique ON live_stream_orders (checkout_session_id);
CREATE INDEX IF NOT EXISTS live_stream_orders_stream_idx ON live_stream_orders (stream_id, announced_at);

CREATE TABLE IF NOT EXISTS live_cohost_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id   uuid NOT NULL,
  cohost_id   text NOT NULL,
  product_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_cohost_products_unique ON live_cohost_products (stream_id, cohost_id, product_id);
CREATE INDEX IF NOT EXISTS live_cohost_products_stream_idx ON live_cohost_products (stream_id);

CREATE TABLE IF NOT EXISTS live_gift_platform_fees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_entry_id  uuid NOT NULL,
  stream_id      text NOT NULL,
  buyer_id       text NOT NULL,
  seller_id      text NOT NULL,
  gross_cents    integer NOT NULL,
  fee_bps        integer NOT NULL,
  fee_cents      integer NOT NULL,
  net_cents      integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_gift_platform_fees_gift_unique ON live_gift_platform_fees (gift_entry_id);
CREATE INDEX IF NOT EXISTS live_gift_platform_fees_stream_idx ON live_gift_platform_fees (stream_id);
