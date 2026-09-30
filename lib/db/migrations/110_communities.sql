-- 110: Topic group chats ("Communities") — unlimited members, cursor history,
-- a per-member read cursor instead of per-member unread rows, and throttled
-- push state kept on the community row. See lib/db/src/schema/communities.ts.

CREATE TABLE IF NOT EXISTS communities (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  icon_key                TEXT,
  icon_url                TEXT,
  cover_url               TEXT,
  kind                    TEXT NOT NULL DEFAULT 'user',
  visibility              TEXT NOT NULL DEFAULT 'public',
  require_approval        BOOLEAN NOT NULL DEFAULT false,
  owner_id                TEXT,
  invite_code             TEXT,
  member_count            INTEGER NOT NULL DEFAULT 0,
  last_seq                BIGINT NOT NULL DEFAULT 0,
  last_message_preview    TEXT,
  last_message_sender_name TEXT,
  last_message_at         TIMESTAMPTZ,
  push_pending_count      INTEGER NOT NULL DEFAULT 0,
  push_pending_sender     TEXT,
  push_pending_preview    TEXT,
  last_push_at            TIMESTAMPTZ,
  report_count            INTEGER NOT NULL DEFAULT 0,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS communities_slug_unique ON communities (slug);
CREATE UNIQUE INDEX IF NOT EXISTS communities_invite_code_unique ON communities (invite_code);
CREATE INDEX IF NOT EXISTS communities_discover_idx ON communities (visibility, kind, member_count);
CREATE INDEX IF NOT EXISTS communities_owner_idx ON communities (owner_id, created_at);

CREATE TABLE IF NOT EXISTS community_members (
  community_id   UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'member',
  muted          BOOLEAN NOT NULL DEFAULT false,
  last_read_seq  BIGINT NOT NULL DEFAULT 0,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_members_user_idx ON community_members (user_id, joined_at);
CREATE INDEX IF NOT EXISTS community_members_push_idx ON community_members (community_id, muted, user_id);
CREATE INDEX IF NOT EXISTS community_members_role_idx ON community_members (community_id, role);

CREATE TABLE IF NOT EXISTS community_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  seq           BIGINT NOT NULL,
  sender_id     TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to_id   UUID,
  deleted_at    TIMESTAMPTZ,
  deleted_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT community_messages_community_seq_unique UNIQUE (community_id, seq)
);
CREATE INDEX IF NOT EXISTS community_messages_sender_idx ON community_messages (sender_id, created_at);

CREATE TABLE IF NOT EXISTS community_message_reactions (
  message_id     UUID NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  reaction_type  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_bans (
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  banned_by     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_join_requests (
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

-- Launch communities (Brandthread-run; admin-editable later). Idempotent on slug.
INSERT INTO communities (name, slug, description, icon_key, kind, visibility) VALUES
  ('Graphic Design Community', 'graphic-design', 'Logos, type, layouts and print-ready files. Share work, get feedback.', 'pen-tool', 'official', 'public'),
  ('Photography & Content', 'photography-content', 'Product shots, lookbooks, reels and everything content.', 'camera', 'official', 'public'),
  ('Ads & Marketing', 'ads-marketing', 'What''s converting, what''s not, and the tactics behind it.', 'trending-up', 'official', 'public'),
  ('Creative Direction', 'creative-direction', 'Concepts, moodboards and building a brand people remember.', 'compass', 'official', 'public'),
  ('Streetwear Founders', 'streetwear-founders', 'Founders talking drops, pricing and growing a label.', 'shopping-bag', 'official', 'public'),
  ('Sourcing & Manufacturing', 'sourcing-manufacturing', 'Factories, fabrics, samples and getting production right.', 'package', 'official', 'public')
ON CONFLICT (slug) DO NOTHING;
