-- ─── Migration 112: Admin dashboard ──────────────────────────────────────────
-- Platform-admin tooling (users.role = 'admin'). Additive and idempotent:
-- six new tables, no changes to existing ones.
--   admin_audit_log         append-only record of every admin action
--   admin_announcements     announcements sent to all / sellers / buyers
--   featured_items          brands and threads featured on Discover
--   admin_invite_codes      admin-generated invite codes (+ redemptions)
--   ai_usage_events         per-user AI cost ledger, fed by the OpenAI client hook
--   boost_reviews           admin approval of paid promoted threads

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_clerk_id  TEXT NOT NULL,
  actor_email     TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT,
  target_id       TEXT,
  summary         TEXT NOT NULL DEFAULT '',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx   ON admin_audit_log (actor_clerk_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx  ON admin_audit_log (target_type, target_id);

-- The audit log is append-only: corrections are new rows.
CREATE OR REPLACE FUNCTION admin_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_log_no_update ON admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION admin_audit_log_immutable();

CREATE TABLE IF NOT EXISTS admin_announcements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  audience        TEXT NOT NULL DEFAULT 'all',          -- 'all' | 'sellers' | 'buyers'
  send_push       BOOLEAN NOT NULL DEFAULT TRUE,
  send_in_app     BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL DEFAULT 'sending',      -- 'sending' | 'sent' | 'failed'
  recipient_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS admin_announcements_created_idx ON admin_announcements (created_at DESC);

CREATE TABLE IF NOT EXISTS featured_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,                            -- 'brand' | 'thread'
  target_id   TEXT NOT NULL,                            -- brand: users.clerk_id, thread: posts.id
  label       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT featured_items_kind_valid CHECK (kind IN ('brand', 'thread')),
  CONSTRAINT featured_items_target_unique UNIQUE (kind, target_id)
);
CREATE INDEX IF NOT EXISTS featured_items_active_idx ON featured_items (kind, active, position);

CREATE TABLE IF NOT EXISTS admin_invite_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  label        TEXT,
  max_uses     INTEGER,                                 -- NULL = unlimited
  uses         INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ,
  disabled_at  TIMESTAMPTZ,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_invite_codes_max_uses_positive CHECK (max_uses IS NULL OR max_uses > 0)
);

CREATE TABLE IF NOT EXISTS admin_invite_code_uses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id     UUID NOT NULL REFERENCES admin_invite_codes(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL UNIQUE,                     -- Clerk ID; a user redeems one code
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_invite_code_uses_code_idx ON admin_invite_code_uses (code_id);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT,                                  -- Clerk ID; NULL for system calls
  feature        TEXT NOT NULL,                         -- 'chat' | 'image' | 'image_edit'
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  -- Estimated cost in millionths of a US dollar (integer, never floating point).
  cost_micros    BIGINT NOT NULL DEFAULT 0,
  priced         BOOLEAN NOT NULL DEFAULT TRUE,         -- FALSE when the model has no known price
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_idx    ON ai_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx ON ai_usage_events (created_at DESC);

CREATE TABLE IF NOT EXISTS boost_reviews (
  boost_id     UUID PRIMARY KEY REFERENCES boosts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,                           -- 'approved' | 'rejected'
  reason       TEXT,
  reviewed_by  TEXT NOT NULL,
  reviewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT boost_reviews_status_valid CHECK (status IN ('approved', 'rejected'))
);
