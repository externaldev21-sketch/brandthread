-- Rename the current highest seller subscription tier from Scale to Pro.
-- The plan column is text, so this is safe and idempotent across active,
-- inactive, and historical subscription records.
UPDATE users
SET subscription_plan_id = 'pro',
    updated_at = NOW()
WHERE subscription_plan_id = 'scale';

UPDATE seller_subscription_entitlements
SET plan_id = 'pro',
    updated_at = NOW()
WHERE plan_id = 'scale';