-- 270: Account-wide email suppression list. Resend reports hard bounces and
-- spam complaints for every email we send (campaigns and transactional);
-- addresses recorded here are skipped by sendBrandthreadEmail so we stop
-- mailing dead or complaining inboxes and protect sender reputation.
-- Additive only.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email       TEXT PRIMARY KEY,           -- always stored lower-cased
  reason      TEXT NOT NULL,              -- 'bounced' | 'complained'
  source      TEXT NOT NULL DEFAULT 'resend_webhook',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
