-- Migration 037: indexed substring search and richer message persistence
--
-- All statements are intentionally idempotent because this file is applied by
-- the ordered migration runner and may also be used during a fresh setup.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes preserve the existing case-insensitive substring behavior
-- while avoiding sequential scans for normal directory/search terms.
CREATE INDEX IF NOT EXISTS customers_name_trgm_idx
  ON customers USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_email_trgm_idx
  ON customers USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS manufacturers_business_name_trgm_idx
  ON manufacturers USING GIN (business_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manufacturers_specialty_trgm_idx
  ON manufacturers USING GIN (specialty gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manufacturers_description_trgm_idx
  ON manufacturers USING GIN (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manufacturers_country_trgm_idx
  ON manufacturers USING GIN (country gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_display_name_trgm_idx
  ON users USING GIN (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_brand_name_trgm_idx
  ON users USING GIN (brand_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_username_trgm_idx
  ON users USING GIN (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING GIN (name gin_trgm_ops);

-- Conversation-level moderation/reporting and retention state.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'clear';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS report_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

-- Message delivery/read state is intentionally nullable: existing messages
-- predate delivery tracking and should not appear falsely read or delivered.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'clear';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS message_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
  ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_moderation_review_idx
  ON conversations(moderation_status, reported_at DESC);
CREATE INDEX IF NOT EXISTS conversations_retention_idx
  ON conversations(retention_until);
CREATE INDEX IF NOT EXISTS conversation_participants_unread_idx
  ON conversation_participants(user_id, unread_count, last_read_at);
CREATE INDEX IF NOT EXISTS messages_conversation_order_idx
  ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_read_work_idx
  ON messages(conversation_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_moderation_review_idx
  ON messages(moderation_status, reported_at DESC);
CREATE INDEX IF NOT EXISTS messages_retention_idx
  ON messages(retention_until);
CREATE INDEX IF NOT EXISTS message_reports_review_idx
  ON message_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS message_reports_message_idx
  ON message_reports(message_id, created_at DESC);