-- 112: Buyer saved sizes / preferences (foundation for size recommendations
-- and the onboarding survey). One row per Clerk user. `sizes` holds
-- {tops, bottoms, outerwear, shoes, measurements:{heightCm, weightKg, chestCm,
-- waistCm, hipsCm}}. `style_interests` mirrors (never replaces)
-- users.buyer_style_interests. Erased with the account (routes/auth.ts).
CREATE TABLE IF NOT EXISTS buyer_preferences (
  user_id             TEXT PRIMARY KEY,
  sizes               JSONB NOT NULL DEFAULT '{}'::jsonb,
  liked_brand_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  style_interests     JSONB NOT NULL DEFAULT '[]'::jsonb,
  survey_completed_at TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
