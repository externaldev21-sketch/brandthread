-- 611: Opt-in SMS order updates (Twilio). Consent lives on the user row;
-- every user defaults to NOT opted in. sms_phone is E.164 and only set once the
-- number has been confirmed with a one-time code.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_order_updates BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_opted_in_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_opted_out_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS users_sms_phone_idx ON users (sms_phone) WHERE sms_phone IS NOT NULL;
