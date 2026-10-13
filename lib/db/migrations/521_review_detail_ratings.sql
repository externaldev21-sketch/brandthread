-- Seller detail ratings (feature 64): buyers can rate shipping speed and
-- whether the item matched its listing, next to the overall star rating.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS ship_speed_rating integer;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS accuracy_rating integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_ship_speed_rating_range') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_ship_speed_rating_range
      CHECK (ship_speed_rating IS NULL OR ship_speed_rating BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_accuracy_rating_range') THEN
    ALTER TABLE reviews ADD CONSTRAINT reviews_accuracy_rating_range
      CHECK (accuracy_rating IS NULL OR accuracy_rating BETWEEN 1 AND 5);
  END IF;
END $$;
