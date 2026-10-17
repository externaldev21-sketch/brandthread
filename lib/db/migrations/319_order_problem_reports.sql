-- 319: Buyer "Report a problem" on an order is stored server-side (previously
-- AsyncStorage only, so neither the seller nor support ever saw it).
CREATE TABLE IF NOT EXISTS order_problem_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id         TEXT NOT NULL,
  order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
  seller_id        TEXT,
  order_number     TEXT,
  type             TEXT NOT NULL,
  description      TEXT NOT NULL,
  evidence_urls    JSONB NOT NULL DEFAULT '[]'::jsonb,
  contacted_seller BOOLEAN NOT NULL DEFAULT FALSE,
  status           TEXT NOT NULL DEFAULT 'open',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_problem_reports_buyer_idx  ON order_problem_reports (buyer_id, created_at);
CREATE INDEX IF NOT EXISTS order_problem_reports_order_idx  ON order_problem_reports (order_id);
CREATE INDEX IF NOT EXISTS order_problem_reports_seller_idx ON order_problem_reports (seller_id, created_at);

-- Reports are mirrored into support_tickets (support visibility). That table
-- was only created lazily by routes/support.ts at boot; create it here too
-- (same definition, idempotent) so the mirror never depends on boot order.
CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id    TEXT    NOT NULL,
  email       TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'general',
  status      TEXT    NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
