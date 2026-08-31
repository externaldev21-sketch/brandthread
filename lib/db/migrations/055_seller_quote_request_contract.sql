-- Align the original quote-request table with the current Drizzle contract.
-- Existing installs created request_type/description before the seller-hub
-- route standardized on type/details and added product metadata.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seller_quote_requests' AND column_name = 'request_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seller_quote_requests' AND column_name = 'type'
  ) THEN
    ALTER TABLE seller_quote_requests RENAME COLUMN request_type TO type;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seller_quote_requests' AND column_name = 'description'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seller_quote_requests' AND column_name = 'details'
  ) THEN
    ALTER TABLE seller_quote_requests RENAME COLUMN description TO details;
  END IF;
END $$;

ALTER TABLE seller_quote_requests
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'apparel',
  ADD COLUMN IF NOT EXISTS colorways TEXT,
  ADD COLUMN IF NOT EXISTS quoted_turnaround TEXT;

ALTER TABLE seller_quote_requests
  ALTER COLUMN status SET DEFAULT 'submitted';