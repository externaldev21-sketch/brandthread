-- ─── Migration 262: consent to send content to AI providers (QA-0043) ───────
-- App Store Guideline 5.1.2(i): before personal data (photos, prompts, product
-- details) is sent to a third-party AI provider, the app discloses it and
-- asks permission. One row per account; withdrawing sets granted_at = NULL.

CREATE TABLE IF NOT EXISTS ai_data_consents (
  clerk_user_id TEXT PRIMARY KEY,
  version       TEXT NOT NULL,
  granted_at    TIMESTAMPTZ,
  withdrawn_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
