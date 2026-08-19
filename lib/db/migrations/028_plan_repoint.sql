-- Migration 028: Repoint plan IDs to match new three-tier pricing.
--
-- Old catalogue: starter (free), growth ($29), pro ($79)
-- New catalogue: starter ($29), growth ($79), scale ($199)
--
-- Existing subscribers map as follows:
--   old growth ($29) → new starter ($29)
--   old pro    ($79) → new growth  ($79)
-- Any "scale" subscriber already has the correct value.
-- The "starter" (free / none) default stays at 'starter'.
--
-- All UPDATE statements are idempotent.

UPDATE users
SET subscription_plan_id = 'starter'
WHERE subscription_plan_id = 'growth'
  AND subscription_status NOT IN ('canceled', 'none');

UPDATE users
SET subscription_plan_id = 'growth'
WHERE subscription_plan_id = 'pro'
  AND subscription_status NOT IN ('canceled', 'none');
