-- ─── Migration 271: Brandthread-funded first-order discount ──────────────────
-- $5 off a signed-in buyer's first paid order (in-app one-page checkout),
-- paid for by Brandthread: the seller still receives the full price through a
-- supplemental platform-funded transfer (api-server
-- lib/promotions/firstOrderDiscount.ts). Idempotent.

CREATE TABLE IF NOT EXISTS first_order_discounts (
  buyer_id            TEXT PRIMARY KEY,           -- one claim per buyer, ever
  status              TEXT NOT NULL,              -- reserved | released | applied | reversed
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  checkout_session_id UUID,
  order_id            UUID,
  seller_id           TEXT,
  stripe_transfer_id  TEXT,
  reserved_at         TIMESTAMPTZ,
  applied_at          TIMESTAMPTZ,
  reversed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS first_order_discounts_checkout_idx
  ON first_order_discounts (checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS first_order_discounts_order_uq
  ON first_order_discounts (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS first_order_discount_cents INTEGER NOT NULL DEFAULT 0;

-- OFF until Dev has run one real test-mode purchase end to end (see PR body):
-- the money path is covered by integration tests against a mocked Stripe only.
INSERT INTO feature_flags (key, enabled, description)
VALUES ('firstOrderPlatformDiscount', false, 'Brandthread-funded $5 off a buyer''s first paid order (seller still paid in full)')
ON CONFLICT (key) DO NOTHING;
