-- First-week checklist: one quiet, dismissible card with 4 real steps.
-- Step completion is computed from existing data; this table only holds what
-- has no other record (store shared, dismissed forever, reward granted).
CREATE TABLE IF NOT EXISTS first_week_checklist (
  user_id            TEXT PRIMARY KEY,
  store_shared_at    TIMESTAMPTZ,
  dismissed_at       TIMESTAMPTZ,
  reward_granted_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reward ($2 Thread Cash, once per account, idempotency key
-- first-week:<userId>). Moderators can turn it off without hiding the card.
INSERT INTO feature_flags (key, enabled, description)
VALUES ('firstWeekReward', true, 'Thread Cash reward for finishing the first-week checklist')
ON CONFLICT (key) DO NOTHING;
