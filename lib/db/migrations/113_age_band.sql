-- 113: Age gate. Only the derived age band is stored -- never the date of birth.
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_band TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS underage_blocked_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_age_band_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_age_band_check CHECK (age_band IS NULL OR age_band IN ('under_13', '13_17', '18_plus'));
  END IF;
END $$;
