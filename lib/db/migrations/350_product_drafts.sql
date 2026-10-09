-- 350: Cross-device sync for Add Product wizard drafts.
-- A side table (never products.status='draft') so half-finished wizard state
-- can't leak into product lists, search, analytics or plan limits.
CREATE TABLE IF NOT EXISTS product_drafts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         TEXT NOT NULL,
  client_draft_id  TEXT NOT NULL,
  data             JSONB NOT NULL,
  created_by       TEXT,
  updated_at       TIMESTAMPTZ(3) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_drafts_owner_client_unique ON product_drafts (owner_id, client_draft_id);
CREATE INDEX IF NOT EXISTS product_drafts_owner_updated_idx ON product_drafts (owner_id, updated_at);

-- Buyer problem reports are filed as support tickets (category
-- 'order_problem'). routes/support.ts creates this table at startup; declaring
-- it here too makes the dependency explicit and migration-backed. Identical
-- shape, so this is a no-op wherever it already exists.
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
CREATE INDEX IF NOT EXISTS support_tickets_clerk_created_idx ON support_tickets (clerk_id, created_at DESC);
