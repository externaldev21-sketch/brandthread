-- Migration 019: Team members and activity log
CREATE TABLE IF NOT EXISTS team_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        TEXT NOT NULL,
  email           TEXT NOT NULL,
  name            TEXT,
  role            TEXT NOT NULL DEFAULT 'staff',
  status          TEXT NOT NULL DEFAULT 'pending',
  invite_token    TEXT UNIQUE,
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at     TIMESTAMPTZ,
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_id, email)
);

CREATE TABLE IF NOT EXISTS team_activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    TEXT NOT NULL,
  member_id   UUID REFERENCES team_members(id) ON DELETE SET NULL,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
