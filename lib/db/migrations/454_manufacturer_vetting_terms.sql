-- 454: Manufacturer trust (light vetting + manufacturer terms).
--
-- New manufacturers start as 'pending_verification': they can sign up and
-- build a profile right away, but they stay out of the public directory and
-- cannot send payable order cards until they are verified (email verified +
-- phone on file + Stripe payouts ready, or an admin approval).
-- 'pending_verification' | 'verified' | 'rejected'
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending_verification';
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS verification_note TEXT;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS verification_decided_by TEXT;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS verification_decided_at TIMESTAMPTZ;

-- Manufacturer Terms accepted at registration (history lives in legal_acceptances).
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Grandfather every manufacturer that is already active as verified. This
-- file runs once (schema_migrations), so manufacturers created later stay
-- pending until they meet the verification rules.
UPDATE manufacturers
   SET verification_status = 'verified',
       verified_at = COALESCE(verified_at, NOW()),
       verification_note = COALESCE(verification_note, 'Grandfathered when manufacturer vetting launched'),
       verification_decided_at = COALESCE(verification_decided_at, NOW())
 WHERE status = 'active'
   AND verification_status = 'pending_verification';

CREATE INDEX IF NOT EXISTS manufacturers_directory_verified_idx
  ON manufacturers (status, is_public_directory, verification_status);
