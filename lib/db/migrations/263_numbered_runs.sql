-- 263: Numbered pieces (limited numbered runs).
-- A seller marks a product as a numbered run of `edition_size` pieces.
-- `edition_issued` counts numbers handed out so far; each paid order item of
-- that product takes the next `quantity` numbers, stored as the first number
-- on the line in `order_items.edition_number`. Numbers are never reused, so a
-- refund leaves a gap rather than renumbering anyone else's piece.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS edition_size   INTEGER,
  ADD COLUMN IF NOT EXISTS edition_issued INTEGER NOT NULL DEFAULT 0;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS edition_number INTEGER;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_edition_size_range
    CHECK (edition_size IS NULL OR (edition_size BETWEEN 2 AND 100000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_edition_issued_within_size
    CHECK (edition_size IS NULL OR edition_issued <= edition_size);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
