-- 261: Resale-style listing attributes captured by the Sell-an-item form
-- (department/subcategory, brand label, condition, colours, material, parcel
-- size / who pays shipping). One jsonb column so the listing form can grow
-- without a migration per field; validated server-side (lib/listingDetails).
ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_details JSONB;
