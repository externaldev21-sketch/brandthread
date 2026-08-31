-- Complete the quote-request contract for databases created by migration 005.
-- Kept separate because migration 055 may already have been applied while the
-- remaining historical type/nullability mismatch was discovered.
UPDATE seller_quote_requests
SET product_name = 'Untitled request'
WHERE product_name IS NULL;

ALTER TABLE seller_quote_requests
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE UUID USING id::uuid,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN product_name SET NOT NULL;