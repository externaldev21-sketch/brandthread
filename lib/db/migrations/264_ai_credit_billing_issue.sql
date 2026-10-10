-- 261: AI credits for past-due subscriptions.
-- When the ledger first sees an account's subscription past due (Stripe
-- past_due, store billing grace), it records the time here. AI tools keep a
-- reduced allowance for AI_PAST_DUE_GRACE_DAYS from then, then stop until the
-- subscription is paid again (the column is cleared on the next paid state).
ALTER TABLE ai_credit_accounts
  ADD COLUMN IF NOT EXISTS billing_issue_since TIMESTAMPTZ;
