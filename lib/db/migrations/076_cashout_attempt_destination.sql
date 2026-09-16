ALTER TABLE seller_cashout_attempts
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS bank_destination_id TEXT;