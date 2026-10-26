-- 644: Taxes & duties switches are ON unless the seller explicitly turned them
-- off. stripe_tax_enabled / charge_shipping_tax default to false, so they can't
-- tell "never opened the screen" from "turned it off"; these flags are set only
-- by an explicit switch-off (PATCH /api/taxes/config) and cleared by switching
-- back on. Checkout keeps collecting tax for everyone else.
ALTER TABLE seller_tax_config ADD COLUMN IF NOT EXISTS automatic_tax_opted_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE seller_tax_config ADD COLUMN IF NOT EXISTS shipping_tax_opted_out BOOLEAN NOT NULL DEFAULT FALSE;
