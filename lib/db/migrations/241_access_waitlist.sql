-- 241: Invite-only launch mode. Codes themselves reuse admin_invite_codes /
-- admin_invite_code_uses (migration 112); this adds the waitlist and the
-- (OFF by default) `inviteOnlySignup` feature flag row.
CREATE TABLE IF NOT EXISTS access_waitlist_signups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_at     TIMESTAMPTZ,
  invited_by     TEXT,
  invite_code_id UUID REFERENCES admin_invite_codes(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS access_waitlist_signups_email_ci ON access_waitlist_signups (lower(email));
CREATE INDEX IF NOT EXISTS access_waitlist_signups_created_idx ON access_waitlist_signups (created_at DESC);

INSERT INTO feature_flags (key, enabled, description)
VALUES ('inviteOnlySignup', false, 'New accounts need an invite code to finish onboarding')
ON CONFLICT (key) DO NOTHING;
