-- 114: per-seller payment settings. First setting: Buy now, pay later
-- (Klarna / Afterpay) opt-in. Off by default; the platform-level switch
-- (STRIPE_BNPL_ENABLED) must also be on before a buyer ever sees it.
CREATE TABLE IF NOT EXISTS seller_payment_settings (
  seller_id     TEXT PRIMARY KEY,
  bnpl_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
