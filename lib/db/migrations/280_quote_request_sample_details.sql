-- 280: Sample requests from a manufacturer's catalog, shipped to the seller.
-- A quote/sample request can now point at one of that manufacturer's catalog
-- products, carry the requested sizes and catalog customization options, and
-- the address the sample ships to. All columns are nullable, so every existing
-- request (and the free-form "Something else" path) keeps working unchanged.
ALTER TABLE seller_quote_requests
  ADD COLUMN IF NOT EXISTS catalog_product_id UUID REFERENCES manufacturer_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sizes TEXT,
  ADD COLUMN IF NOT EXISTS sample_options JSON,
  ADD COLUMN IF NOT EXISTS ship_to JSON;

CREATE INDEX IF NOT EXISTS seller_quote_requests_catalog_product_idx
  ON seller_quote_requests (catalog_product_id);
