-- 119: Referral program tracking (give $10 / get $10 Thread Cash)
-- Invitee gets Thread Cash when they join with a code; the inviter gets it
-- when the invitee's first qualifying paid order lands. Additive and
-- idempotent; existing referral rows are back-filled as 'pending'.

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'; -- pending | qualified | rewarded | capped
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualifying_order_id TEXT;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS invitee_reward_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS inviter_reward_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS invitee_reward_entry_id UUID;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS inviter_reward_entry_id UUID;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS rewarded_at TIMESTAMPTZ;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'code'; -- code | link

CREATE INDEX IF NOT EXISTS referrals_inviter_status_idx ON referrals (inviter_id, status);

-- Aggregate invite-link tracking (no PII: a counter and a timestamp only).
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_link_clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_last_clicked_at TIMESTAMPTZ;
