-- Migration 084: money ledger, explicit money state machines, per-order
-- releases, refunds, and drop escrow lifecycle.
--
-- Safe to re-run: every statement is IF NOT EXISTS / guarded, backfills only
-- touch rows that have not been backfilled, and ledger inserts use
-- deterministic idempotency keys with ON CONFLICT DO NOTHING.
-- See docs/payments/money-flow.md.

-- ─── Double-entry ledger ────────────────────────────────────────────────────
-- Each ledger_transaction is one business event (an order paid, a release, a
-- refund…). Its postings move cents between accounts and must sum to zero.
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT NOT NULL UNIQUE,
  kind             TEXT NOT NULL,
  seller_id        TEXT,
  order_id         UUID,
  drop_id          UUID,
  sample_order_id  UUID,
  stripe_object_id TEXT,
  memo             TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_transactions_seller_idx ON ledger_transactions (seller_id, occurred_at);
CREATE INDEX IF NOT EXISTS ledger_transactions_order_idx ON ledger_transactions (order_id);
CREATE INDEX IF NOT EXISTS ledger_transactions_drop_idx ON ledger_transactions (drop_id);

CREATE TABLE IF NOT EXISTS ledger_postings (
  id             BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES ledger_transactions (id),
  account        TEXT NOT NULL,
  party_id       TEXT,
  drop_id        UUID,
  order_id       UUID,
  amount_cents   BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_postings_transaction_idx ON ledger_postings (transaction_id);
CREATE INDEX IF NOT EXISTS ledger_postings_account_party_idx ON ledger_postings (account, party_id);
CREATE INDEX IF NOT EXISTS ledger_postings_drop_idx ON ledger_postings (drop_id);
CREATE INDEX IF NOT EXISTS ledger_postings_order_idx ON ledger_postings (order_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_postings_amount_nonzero') THEN
    ALTER TABLE ledger_postings ADD CONSTRAINT ledger_postings_amount_nonzero CHECK (amount_cents <> 0);
  END IF;
END $$;

-- Every transaction must balance to zero. Checked at COMMIT so a service can
-- insert its postings one by one inside a single database transaction.
CREATE OR REPLACE FUNCTION ledger_assert_transaction_balanced() RETURNS trigger AS $$
DECLARE
  total BIGINT;
  posting_count INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0), COUNT(*) INTO total, posting_count
  FROM ledger_postings WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced by % cents', NEW.transaction_id, total
      USING ERRCODE = 'check_violation';
  END IF;
  IF posting_count < 2 THEN
    RAISE EXCEPTION 'ledger transaction % needs at least two postings', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_postings_balanced') THEN
    CREATE CONSTRAINT TRIGGER ledger_postings_balanced
      AFTER INSERT ON ledger_postings
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ledger_assert_transaction_balanced();
  END IF;
END $$;

-- The ledger is append-only. Corrections are new, opposite transactions.
CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the money ledger is append-only (% on %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_postings_immutable') THEN
    CREATE TRIGGER ledger_postings_immutable
      BEFORE UPDATE OR DELETE ON ledger_postings
      FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_transactions_immutable') THEN
    CREATE TRIGGER ledger_transactions_immutable
      BEFORE UPDATE OR DELETE ON ledger_transactions
      FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
  END IF;
END $$;

-- ─── Order money columns ────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS funds_state TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS charge_model TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_charge_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_application_fee_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS processing_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS processing_fee_charged_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_net_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee_refunded_cents INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_funds_state_valid') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_funds_state_valid CHECK (
      funds_state IS NULL OR funds_state IN ('settled_direct', 'held', 'release_pending', 'released', 'refunded')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_charge_model_valid') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_charge_model_valid CHECK (
      charge_model IS NULL OR charge_model IN ('destination', 'held')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_nonnegative') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_money_nonnegative CHECK (
      platform_fee_cents >= 0 AND processing_fee_cents >= 0 AND processing_fee_charged_cents >= 0
      AND seller_net_cents >= 0 AND refunded_cents >= 0 AND platform_fee_refunded_cents >= 0
    );
  END IF;
  -- Refunds can never exceed what Stripe captured. Legacy rows predate
  -- gross_charged_cents, so the check only applies when it is populated.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_refund_within_gross') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_refund_within_gross CHECK (
      gross_charged_cents = 0 OR refunded_cents <= gross_charged_cents
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS orders_funds_state_idx ON orders (funds_state) WHERE funds_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_stripe_payment_intent_idx ON orders (stripe_payment_intent_id);

-- Money decisions made when the Checkout Session was created, so the webhook
-- uses exactly the fee and charge model Stripe was told about.
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS charge_model TEXT;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS drop_id UUID;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS processing_fee_estimate_cents INTEGER;

-- ─── Drop escrow lifecycle ──────────────────────────────────────────────────
ALTER TABLE drops ADD COLUMN IF NOT EXISTS escrow_state TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS fulfillment_deadline_at TIMESTAMPTZ;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS escrow_failed_at TIMESTAMPTZ;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS escrow_failure_reason TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drops_escrow_state_valid') THEN
    ALTER TABLE drops ADD CONSTRAINT drops_escrow_state_valid CHECK (
      escrow_state IS NULL OR escrow_state IN ('collecting', 'production', 'fulfilling', 'completed', 'failing', 'failed')
    );
  END IF;
END $$;
UPDATE drops
SET escrow_state = CASE WHEN status = 'fulfilled' THEN 'fulfilling' ELSE 'collecting' END
WHERE type = 'pre-order' AND escrow_state IS NULL;
-- Legacy preorder drops had no deadline. Give them the estimated ship date
-- plus 30 days, or 120 days after creation (inside the card-network dispute
-- window) when no ship date was set.
UPDATE drops
SET fulfillment_deadline_at = COALESCE(estimated_ship_date + interval '30 days', created_at + interval '120 days')
WHERE type = 'pre-order' AND fulfillment_deadline_at IS NULL;
CREATE INDEX IF NOT EXISTS drops_escrow_deadline_idx ON drops (fulfillment_deadline_at)
  WHERE escrow_state IN ('collecting', 'production', 'fulfilling', 'failing');

-- ─── Per-order releases (payouts of held funds) ─────────────────────────────
CREATE TABLE IF NOT EXISTS order_releases (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL UNIQUE REFERENCES orders (id),
  drop_id            UUID,
  seller_id          TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'pending',
  trigger            TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL DEFAULT 0,
  label_cents        INTEGER NOT NULL DEFAULT 0,
  bulk_share_cents   INTEGER NOT NULL DEFAULT 0,
  reversed_cents     INTEGER NOT NULL DEFAULT 0,
  attempt            INTEGER NOT NULL DEFAULT 1,
  stripe_transfer_id TEXT,
  stripe_destination TEXT,
  last_error_code    TEXT,
  last_error_message TEXT,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_releases_state_valid') THEN
    ALTER TABLE order_releases ADD CONSTRAINT order_releases_state_valid CHECK (
      state IN ('pending', 'transferring', 'paid', 'failed', 'reversed')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_releases_amounts_valid') THEN
    ALTER TABLE order_releases ADD CONSTRAINT order_releases_amounts_valid CHECK (
      amount_cents >= 0 AND label_cents >= 0 AND bulk_share_cents >= 0
      AND reversed_cents >= 0 AND reversed_cents <= amount_cents AND attempt >= 1
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS order_releases_seller_idx ON order_releases (seller_id);
CREATE INDEX IF NOT EXISTS order_releases_drop_idx ON order_releases (drop_id);
CREATE INDEX IF NOT EXISTS order_releases_open_idx ON order_releases (state, updated_at)
  WHERE state IN ('pending', 'transferring', 'failed');

-- ─── Refunds ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_refunds (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                    UUID NOT NULL REFERENCES orders (id),
  seller_id                   TEXT NOT NULL,
  idempotency_key             TEXT NOT NULL UNIQUE,
  amount_cents                INTEGER NOT NULL,
  reason                      TEXT NOT NULL,
  initiated_by                TEXT NOT NULL,
  state                       TEXT NOT NULL DEFAULT 'processing',
  attempt                     INTEGER NOT NULL DEFAULT 1,
  previous_order_status       TEXT,
  stripe_refund_id            TEXT UNIQUE,
  platform_fee_refund_cents   INTEGER NOT NULL DEFAULT 0,
  transfer_reversal_cents     INTEGER NOT NULL DEFAULT 0,
  stripe_transfer_reversal_id TEXT,
  failure_code                TEXT,
  failure_message             TEXT,
  succeeded_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_state_valid') THEN
    ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_state_valid CHECK (
      state IN ('processing', 'succeeded', 'failed')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_refunds_amount_positive') THEN
    ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_amount_positive CHECK (
      amount_cents > 0 AND platform_fee_refund_cents >= 0 AND transfer_reversal_cents >= 0
    );
  END IF;
END $$;
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS previous_order_status TEXT;
CREATE INDEX IF NOT EXISTS order_refunds_order_idx ON order_refunds (order_id);
CREATE INDEX IF NOT EXISTS order_refunds_open_idx ON order_refunds (state) WHERE state = 'processing';

-- ─── Drop wallets become a projection of the ledger ─────────────────────────
-- ledger_version marks wallets whose balances were converted to seller-net
-- amounts (the old code credited gross subtotals and never deducted fees).
ALTER TABLE drop_wallets ADD COLUMN IF NOT EXISTS ledger_version INTEGER NOT NULL DEFAULT 0;

-- ─── Backfill legacy orders ─────────────────────────────────────────────────
-- Orders with a legacy drop-wallet deposit were held on the platform. The old
-- release took 5% of the subtotal, so the seller net is subtotal − 5%.
WITH legacy AS (
  SELECT o.id,
         t.amount_cents AS deposit_cents,
         (t.amount_cents::bigint * 500 + 5000) / 10000 AS fee_cents,
         EXISTS (
           SELECT 1 FROM drop_wallet_transactions r
           WHERE r.order_id = o.id AND r.type = 'release'
         ) AS released
  FROM orders o
  JOIN drop_wallet_transactions t ON t.order_id = o.id AND t.type = 'deposit'
  WHERE o.funds_state IS NULL
)
UPDATE orders o
SET funds_state = CASE WHEN legacy.released THEN 'released' ELSE 'held' END,
    charge_model = 'held',
    platform_fee_cents = legacy.fee_cents,
    seller_net_cents = legacy.deposit_cents - legacy.fee_cents
FROM legacy
WHERE o.id = legacy.id;

UPDATE orders
SET funds_state = 'settled_direct', charge_model = 'destination'
WHERE funds_state IS NULL
  AND stripe_payment_intent_id IS NOT NULL
  AND status <> 'refund_pending';

-- Opening ledger entries for legacy held money, so held balances derive from
-- the ledger from day one.
INSERT INTO ledger_transactions (idempotency_key, kind, seller_id, order_id, drop_id, memo)
SELECT 'legacy-opening/' || o.id, 'legacy_opening', o.owner_id, o.id, o.drop_id,
       'Opening balance for an order held before the ledger existed'
FROM orders o
WHERE o.charge_model = 'held' AND o.seller_net_cents > 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO ledger_postings (transaction_id, account, party_id, drop_id, order_id, amount_cents)
SELECT lt.id, p.account, p.party_id, o.drop_id, o.id, p.amount
FROM ledger_transactions lt
JOIN orders o ON o.id = lt.order_id
CROSS JOIN LATERAL (VALUES
  ('legacy_opening', NULL::text, -o.seller_net_cents::bigint),
  ('seller_held', o.owner_id, o.seller_net_cents::bigint)
) AS p(account, party_id, amount)
WHERE lt.idempotency_key = 'legacy-opening/' || o.id
  AND NOT EXISTS (SELECT 1 FROM ledger_postings lp WHERE lp.transaction_id = lt.id);

INSERT INTO ledger_transactions (idempotency_key, kind, seller_id, order_id, drop_id, memo)
SELECT 'legacy-release/' || o.id, 'legacy_release', o.owner_id, o.id, o.drop_id,
       'Release made before the ledger existed'
FROM orders o
WHERE o.charge_model = 'held' AND o.funds_state = 'released' AND o.seller_net_cents > 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO ledger_postings (transaction_id, account, party_id, drop_id, order_id, amount_cents)
SELECT lt.id, p.account, o.owner_id, o.drop_id, o.id, p.amount
FROM ledger_transactions lt
JOIN orders o ON o.id = lt.order_id
CROSS JOIN LATERAL (VALUES
  ('seller_held', -o.seller_net_cents::bigint),
  ('seller_paid_out', o.seller_net_cents::bigint)
) AS p(account, amount)
WHERE lt.idempotency_key = 'legacy-release/' || o.id
  AND NOT EXISTS (SELECT 1 FROM ledger_postings lp WHERE lp.transaction_id = lt.id);

INSERT INTO order_releases (order_id, drop_id, seller_id, state, trigger, amount_cents, stripe_transfer_id, paid_at)
SELECT o.id, o.drop_id, o.owner_id, 'paid', 'legacy', o.seller_net_cents, r.stripe_transfer_id, r.created_at
FROM orders o
JOIN LATERAL (
  SELECT stripe_transfer_id, created_at FROM drop_wallet_transactions
  WHERE order_id = o.id AND type = 'release' ORDER BY created_at LIMIT 1
) r ON true
WHERE o.charge_model = 'held' AND o.funds_state = 'released'
ON CONFLICT (order_id) DO NOTHING;

-- Legacy bulk payments made from a drop wallet.
INSERT INTO ledger_transactions (idempotency_key, kind, seller_id, drop_id, sample_order_id, stripe_object_id, memo)
SELECT 'legacy-bulk/' || t.id, 'legacy_bulk_payment', w.seller_id, w.drop_id, t.sample_order_id, t.stripe_transfer_id,
       'Bulk payment from held funds before the ledger existed'
FROM drop_wallet_transactions t
JOIN drop_wallets w ON w.id = t.wallet_id
WHERE t.type = 'bulk_payment' AND t.amount_cents > 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO ledger_postings (transaction_id, account, party_id, drop_id, amount_cents)
SELECT lt.id, p.account, p.party_id, w.drop_id, p.amount
FROM drop_wallet_transactions t
JOIN drop_wallets w ON w.id = t.wallet_id
JOIN ledger_transactions lt ON lt.idempotency_key = 'legacy-bulk/' || t.id
LEFT JOIN sample_orders so ON so.id = t.sample_order_id
CROSS JOIN LATERAL (VALUES
  ('seller_held', w.seller_id, -t.amount_cents::bigint),
  ('manufacturer_paid', COALESCE(so.manufacturer_id::text, 'unknown'), t.amount_cents::bigint)
) AS p(account, party_id, amount)
WHERE NOT EXISTS (SELECT 1 FROM ledger_postings lp WHERE lp.transaction_id = lt.id);

-- Legacy shipping labels bought from held preorder funds.
INSERT INTO ledger_transactions (idempotency_key, kind, seller_id, order_id, drop_id, memo)
SELECT 'legacy-label/' || r.id, 'legacy_label', r.owner_id, r.order_id, o.drop_id,
       'Shipping label paid from held funds before the ledger existed'
FROM order_fund_reservations r
JOIN orders o ON o.id = r.order_id
WHERE r.status = 'spent' AND o.drop_id IS NOT NULL AND o.charge_model = 'held'
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO ledger_postings (transaction_id, account, party_id, drop_id, order_id, amount_cents)
SELECT lt.id, p.account, p.party_id, o.drop_id, o.id, p.amount
FROM order_fund_reservations r
JOIN orders o ON o.id = r.order_id
JOIN ledger_transactions lt ON lt.idempotency_key = 'legacy-label/' || r.id
CROSS JOIN LATERAL (VALUES
  ('seller_held', r.owner_id, -r.amount_cents::bigint),
  ('shipping_carrier', NULL::text, r.amount_cents::bigint)
) AS p(account, party_id, amount)
WHERE NOT EXISTS (SELECT 1 FROM ledger_postings lp WHERE lp.transaction_id = lt.id);

-- Convert legacy wallets from gross-subtotal to seller-net amounts, and move
-- "spent" label reservations out of reserved (the old code never did, which
-- permanently shrank the available balance).
UPDATE drop_wallets w
SET balance_cents = w.balance_cents - COALESCE((
      SELECT SUM((t.amount_cents::bigint * 500 + 5000) / 10000)
      FROM drop_wallet_transactions t WHERE t.wallet_id = w.id AND t.type = 'deposit'
    ), 0),
    released_cents = w.released_cents - COALESCE((
      SELECT SUM((t.amount_cents::bigint * 500 + 5000) / 10000)
      FROM drop_wallet_transactions t
      WHERE t.wallet_id = w.id AND t.type = 'deposit'
        AND EXISTS (SELECT 1 FROM drop_wallet_transactions r WHERE r.order_id = t.order_id AND r.type = 'release')
    ), 0),
    ledger_version = 1,
    updated_at = now()
WHERE w.ledger_version = 0;

-- (runs in the same migration transaction as the update above; the guard is
-- the wallet's ledger_version, set to 2 once labels are converted)
UPDATE drop_wallets w
SET reserved_cents = GREATEST(0, w.reserved_cents - spent.total),
    released_cents = w.released_cents + spent.total,
    ledger_version = 2,
    updated_at = now()
FROM (
  SELECT o.drop_id, SUM(r.amount_cents)::int AS total
  FROM order_fund_reservations r
  JOIN orders o ON o.id = r.order_id
  WHERE r.status = 'spent' AND o.drop_id IS NOT NULL
  GROUP BY o.drop_id
) spent
WHERE spent.drop_id = w.drop_id AND w.ledger_version = 1;

UPDATE drop_wallets SET ledger_version = 2 WHERE ledger_version = 1;

-- Wallets created from now on are ledger-native.
ALTER TABLE drop_wallets ALTER COLUMN ledger_version SET DEFAULT 2;
