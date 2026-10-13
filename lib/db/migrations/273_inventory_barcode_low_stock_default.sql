-- 273: Variant barcodes + a store-wide default low-stock level.
--
-- Low-stock level resolution (one rule everywhere):
--   variant's own level  →  product default (product_stock_rules)  →  store default
--   (seller_inventory_settings)  →  5.
-- product_variants.low_stock_threshold stays the EFFECTIVE level that every
-- query and alert reads. low_stock_threshold_inherit says whether that value
-- was set on the variant itself (FALSE) or follows the product / store default
-- (TRUE). On insert a row that gives no level inherits and the trigger below
-- resolves it; a row that gives one keeps it as its own. Inheriting rows are
-- recomputed when a default changes (api-server lib/lowStockThreshold.ts).
-- Existing rows keep their current level and are treated as set on the
-- variant, so nothing a seller already sees changes until they apply a default.

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS product_variants_barcode_idx
  ON product_variants (barcode) WHERE barcode IS NOT NULL;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS low_stock_threshold_inherit BOOLEAN NOT NULL DEFAULT FALSE;
-- No column default (was 10): an omitted level arrives as NULL and the BEFORE
-- INSERT trigger fills it before NOT NULL is checked. One platform fallback: 5.
ALTER TABLE product_variants ALTER COLUMN low_stock_threshold DROP DEFAULT;

CREATE TABLE IF NOT EXISTS seller_inventory_settings (
  seller_id                   TEXT PRIMARY KEY,
  low_stock_threshold_default INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold_default >= 0),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every insert that leaves the level out (seller create, matrix generate, CSV /
-- Etsy import, duplicate of an inheriting variant) gets the resolved level
-- without each writer looking it up.
CREATE OR REPLACE FUNCTION product_variants_resolve_low_stock() RETURNS trigger AS $$
BEGIN
  NEW.low_stock_threshold_inherit := NEW.low_stock_threshold IS NULL;
  IF NEW.low_stock_threshold_inherit THEN
    SELECT COALESCE(r.low_stock_threshold_default, s.low_stock_threshold_default, 5)
      INTO NEW.low_stock_threshold
      FROM products p
      LEFT JOIN product_stock_rules r ON r.product_id = p.id
      LEFT JOIN seller_inventory_settings s ON s.seller_id = p.owner_id
     WHERE p.id = NEW.product_id;
    IF NEW.low_stock_threshold IS NULL THEN
      NEW.low_stock_threshold := 5;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_variants_resolve_low_stock ON product_variants;
CREATE TRIGGER product_variants_resolve_low_stock
  BEFORE INSERT ON product_variants
  FOR EACH ROW EXECUTE FUNCTION product_variants_resolve_low_stock();
