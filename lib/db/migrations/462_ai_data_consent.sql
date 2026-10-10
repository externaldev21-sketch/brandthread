-- 263: AI data-sharing consent (App Store Review Guideline 5.1.2(i)).
-- Brandthread Agent messages (and conversation history) are sent to a
-- third-party AI provider (OpenAI) to generate replies. That must only happen
-- after the user explicitly allows it in the in-app consent sheet. NULL means
-- "not given"; the timestamp records when the user tapped Allow.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_data_consent_at TIMESTAMPTZ;
