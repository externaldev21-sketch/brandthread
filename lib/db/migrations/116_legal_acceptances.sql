-- 116: Legal acceptance history — one row per account and legal document set
-- version agreed to (sign-up checkbox or "updated terms" prompt). The latest
-- agreement stays on users.terms_version / terms_accepted_at.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id    TEXT NOT NULL,
  version     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'signup',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS legal_acceptances_clerk_version_unique ON legal_acceptances (clerk_id, version);
