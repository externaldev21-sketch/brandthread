-- Email-only pre-launch waitlist; independent of product stock alerts.
CREATE TABLE IF NOT EXISTS launch_waitlist_signups (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'landing'
);
CREATE UNIQUE INDEX IF NOT EXISTS launch_waitlist_email_lower_unique
  ON launch_waitlist_signups (lower(email));
