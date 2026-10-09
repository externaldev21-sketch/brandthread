-- 330: Seller payout status comes from Stripe Connect webhooks.
-- seller_payouts is the source of truth for a seller's payout status
-- (payout.created/updated/paid/failed/canceled on the connected account).
-- last_event_created lets late, out-of-order events be ignored.
CREATE TABLE IF NOT EXISTS seller_payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_payout_id   TEXT NOT NULL,
  stripe_account_id  TEXT NOT NULL,
  seller_id          TEXT,
  amount_cents       INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  status             TEXT NOT NULL,
  method             TEXT,
  automatic          BOOLEAN,
  description        TEXT,
  arrival_date       TIMESTAMPTZ,
  failure_code       TEXT,
  failure_message    TEXT,
  destination_last4  TEXT,
  destination_brand  TEXT,
  payout_created_at  TIMESTAMPTZ,
  last_event_created TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_payouts_stripe_payout_id_unique
  ON seller_payouts (stripe_payout_id);
CREATE INDEX IF NOT EXISTS seller_payouts_account_created_idx
  ON seller_payouts (stripe_account_id, payout_created_at);
CREATE INDEX IF NOT EXISTS seller_payouts_seller_status_idx
  ON seller_payouts (seller_id, status);

-- Connected accounts whose pre-webhook payout history was copied from the
-- Stripe API into seller_payouts.
CREATE TABLE IF NOT EXISTS seller_payout_syncs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_account_id TEXT NOT NULL,
  seller_id         TEXT,
  backfilled_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_payout_syncs_account_unique
  ON seller_payout_syncs (stripe_account_id);
