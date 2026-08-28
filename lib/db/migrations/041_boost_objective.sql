-- Persist the seller's Promote objective for reporting and future delivery optimization.
ALTER TABLE boosts
  ADD COLUMN IF NOT EXISTS objective TEXT NOT NULL DEFAULT 'views';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'boosts_objective_check'
  ) THEN
    ALTER TABLE boosts
      ADD CONSTRAINT boosts_objective_check
      CHECK (objective IN ('views', 'likes', 'followers', 'profile_visits'));
  END IF;
END $$;