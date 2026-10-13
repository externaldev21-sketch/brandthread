-- 271: Price history for the product page chart + opt-in price-drop alerts.
--
-- product_price_history holds one row per change of a product's lowest
-- variant price (the price the buyer sees as "from $X"). It is written by a
-- statement-level trigger on product_variants so every write path (seller
-- edit, bulk edit, CSV import, Shopify sync) is covered without each route
-- remembering to call a helper. Statement-level with transition tables, not
-- per-row: a bulk "everything 20% off" UPDATE must compare the product's
-- lowest price before the whole statement with the lowest price after it.
--
-- The first change for a product also records the price it had before, at
-- the product's created_at, so the chart has a start point.

CREATE TABLE IF NOT EXISTS product_price_history (
  id           BIGSERIAL PRIMARY KEY,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_cents  INTEGER NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_price_history_product_recorded_idx
  ON product_price_history (product_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION record_product_price_history() RETURNS trigger AS $$
DECLARE
  pid        UUID;
  new_min    INTEGER;
  old_min    INTEGER;
  latest     INTEGER;
  created    TIMESTAMPTZ;
BEGIN
  FOR pid IN
    SELECT DISTINCT n.product_id
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE n.price_cents IS DISTINCT FROM o.price_cents
  LOOP
    SELECT min(price_cents) INTO new_min FROM product_variants WHERE product_id = pid;
    SELECT min(p) INTO old_min FROM (
      SELECT v.price_cents AS p FROM product_variants v
       WHERE v.product_id = pid AND v.id NOT IN (SELECT id FROM new_rows)
      UNION ALL
      SELECT o.price_cents FROM old_rows o WHERE o.product_id = pid
    ) s;
    CONTINUE WHEN new_min IS NULL OR new_min IS NOT DISTINCT FROM old_min;

    SELECT price_cents INTO latest FROM product_price_history
     WHERE product_id = pid ORDER BY recorded_at DESC, id DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT created_at INTO created FROM products WHERE id = pid;
      INSERT INTO product_price_history (product_id, price_cents, recorded_at)
        VALUES (pid, old_min, LEAST(COALESCE(created, now()), now() - interval '1 second'));
      latest := old_min;
    END IF;
    IF latest IS DISTINCT FROM new_min THEN
      INSERT INTO product_price_history (product_id, price_cents) VALUES (pid, new_min);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS product_variants_price_history ON product_variants;
CREATE TRIGGER product_variants_price_history
  AFTER UPDATE ON product_variants
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION record_product_price_history();

-- "Tell me if the price drops" on a saved item. Off until the buyer turns it
-- on for that item; it is the explicit, per-item request that lets the
-- price-drop push through (lib/pushPolicy.ts explicitRequest). The older
-- notify_on_price_drop column defaults to true and was never a choice the
-- buyer made, so it is not treated as consent.
ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS price_drop_alert BOOLEAN NOT NULL DEFAULT FALSE;
