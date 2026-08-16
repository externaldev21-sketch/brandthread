-- 013: Referral/invite system + per-user DM privacy preference

-- ── Invite codes on users ─────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code     TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code TEXT;   -- code used when this user signed up

-- ── DM privacy setting ────────────────────────────────────────────────────────
-- 'requests'       (default): DMs from non-followers land in Requests inbox
-- 'followers_only': only people the recipient follows can message them at all
ALTER TABLE users ADD COLUMN IF NOT EXISTS dm_privacy TEXT NOT NULL DEFAULT 'requests';

-- ── Referrals tracking table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id  TEXT    NOT NULL,           -- Clerk user ID who shared the code
  invitee_id  TEXT    NOT NULL UNIQUE,    -- Clerk user ID of the new user (one inviter per invitee)
  invite_code TEXT    NOT NULL,           -- the exact code that was used
  joined_at   TIMESTAMP NOT NULL DEFAULT NOW()
  -- Intentionally minimal: reward/status columns can be added later
);

CREATE INDEX IF NOT EXISTS referrals_inviter_idx ON referrals (inviter_id);
