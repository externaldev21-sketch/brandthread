-- Members-only drops (only buyers who already bought from the seller can buy)
-- and the follower "early access is open" push claim.
ALTER TABLE drops ADD COLUMN IF NOT EXISTS members_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS early_access_notified_at TIMESTAMPTZ;
