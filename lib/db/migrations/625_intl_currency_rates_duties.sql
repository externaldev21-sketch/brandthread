-- 625: International selling (items 107-109).
-- 107: display-only currency. fx_rates caches the daily ECB reference rates
--      (base USD) so a server restart doesn't refetch; users.display_currency
--      remembers the buyer's choice across devices. Charges stay in USD.
-- 108: optional ship-from postal code, needed to ask Shippo for live carrier
--      rates on 'calculated' shipping zones (pricing_model is free text, so
--      the new 'calculated' value needs no schema change).
-- 109: duties & import taxes collected at checkout for DDP zones, stored as
--      their own column on the checkout row and on the order.
CREATE TABLE IF NOT EXISTS fx_rates (
  base_currency TEXT NOT NULL,
  currency      TEXT NOT NULL,
  rate          NUMERIC(20, 10) NOT NULL,
  rate_date     TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (base_currency, currency)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_currency TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_ship_from_postal_code TEXT;

ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS duties_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS duties_quote_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS duties_cents INTEGER NOT NULL DEFAULT 0;
