-- ─── Migration 091: Brandthread Agent (official AI friend account) ───────────
-- The Brandthread Agent is a single, well-known system account: a pinned,
-- official conversation in every user's Messages, replied to by a real AI
-- backend (see artifacts/api-server/src/routes/brandthread-agent.ts). This
-- migration is idempotent: safe to run repeatedly across environments
-- without duplicating the account or erroring.

-- ── System account flag ────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN NOT NULL DEFAULT false;

-- At most one system account can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS users_system_account_unique
  ON users (is_system_account)
  WHERE is_system_account = true;

-- ── Agent-only conversation fields ─────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_typing_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_last_nudge_at TIMESTAMPTZ;

-- ── Welcome-conversation idempotency ledger ────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_conversations (
  user_id         TEXT        PRIMARY KEY,
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_type    TEXT        NOT NULL,
  welcome_sent_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_conversations_conversation_idx
  ON agent_conversations (conversation_id);

-- ── The well-known system account itself ───────────────────────────────────
-- clerk_id 'brandthread-agent' matches the preview seed's well-known id
-- (artifacts/mobile/lib/previewInboxData.ts) so real and preview data agree.
-- ON CONFLICT (clerk_id) keeps this idempotent; it never overwrites a row a
-- later run (or a real Clerk sync, which this account will never have) finds.
INSERT INTO users (
  clerk_id, email, name, role, display_name, account_type,
  username, bio, onboarding_complete, verified, verification_status,
  is_system_account, active_standing, dm_privacy
)
VALUES (
  'brandthread-agent',
  'agent@brandthread.app',
  'Brandthread Agent',
  'system',
  'Brandthread Agent',
  'system',
  'brandthread',
  'Your official Brandthread AI friend — here 24/7 for fits, brands, Thread Cash and everything in between.',
  true,
  true,
  'verified',
  true,
  true,
  'requests'
)
ON CONFLICT (clerk_id) DO NOTHING;

-- ── Future welcome-bonus flag — documented, defaults OFF ───────────────────
-- See the PR description: a "welcome bonus" Thread Cash grant was explicitly
-- requested to be left unimplemented/unwired. This flag exists only so a
-- future change can turn it on deliberately; nothing in this change reads it
-- to actually grant Thread Cash.
INSERT INTO feature_flags (key, enabled, description)
VALUES (
  'brandthreadAgentWelcomeBonus',
  false,
  'Grant a small Thread Cash welcome bonus from the Brandthread Agent on first welcome message. NOT implemented — reserved for a future change.'
)
ON CONFLICT (key) DO NOTHING;
