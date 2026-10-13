-- F6 live-auctions: Whatnot-style auctions for 1-of-1 pieces in a live.
CREATE TABLE IF NOT EXISTS live_auctions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id           uuid NOT NULL,
  seller_id           text NOT NULL,
  product_id          uuid NOT NULL,
  variant_id          uuid,
  product_name        text NOT NULL DEFAULT '',
  image_uri           text,
  starting_bid_cents  integer NOT NULL,
  current_bid_cents   integer,
  leader_user_id      text,
  bid_count           integer NOT NULL DEFAULT 0,
  duration_seconds    integer NOT NULL,
  sudden_death        boolean NOT NULL DEFAULT false,
  ends_at             timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'open',
  winner_user_id      text,
  winner_order_id     uuid,
  pay_by              timestamptz,
  settled_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_auctions_one_open_per_stream ON live_auctions (stream_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS live_auctions_stream_idx ON live_auctions (stream_id, created_at);
CREATE INDEX IF NOT EXISTS live_auctions_due_idx ON live_auctions (status, ends_at);
CREATE INDEX IF NOT EXISTS live_auctions_product_idx ON live_auctions (product_id, status);

CREATE TABLE IF NOT EXISTS live_auction_bids (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id    uuid NOT NULL,
  bidder_id     text NOT NULL,
  amount_cents  integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_auction_bids_auction_idx ON live_auction_bids (auction_id, created_at);

CREATE TABLE IF NOT EXISTS live_auction_checkouts (
  checkout_session_id uuid PRIMARY KEY,
  auction_id          uuid NOT NULL,
  buyer_id            text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_auction_checkouts_auction_idx ON live_auction_checkouts (auction_id);

INSERT INTO feature_flags (key, enabled, description)
VALUES ('live_auctions', false, 'Hosts can auction 1-of-1 pieces during a live (Whatnot-style). OFF until launch.')
ON CONFLICT (key) DO NOTHING;
