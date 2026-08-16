-- Migration 007: Messaging, Cart persistence, Saved items, Notification feed

-- ─── Conversations (buyer ↔ seller DM) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  TEXT NOT NULL DEFAULT 'buyer_to_seller',
  last_message          TEXT,
  last_message_at       TIMESTAMPTZ,
  context_order_id      TEXT,
  context_order_number  TEXT,
  context_order_status  TEXT,
  context_product_id    TEXT,
  context_product_name  TEXT,
  context_seller_name   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  handle          TEXT NOT NULL DEFAULT '',
  initials        TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT '#8B5CF6',
  account_type    TEXT NOT NULL DEFAULT 'buyer',
  unread_count    INTEGER NOT NULL DEFAULT 0,
  last_read_at    TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS cp_user_id_idx ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL,
  sender_name     TEXT NOT NULL DEFAULT '',
  sender_initials TEXT NOT NULL DEFAULT '',
  sender_color    TEXT NOT NULL DEFAULT '#8B5CF6',
  body            TEXT NOT NULL,
  attachment      JSONB,
  reply_to_id     UUID,
  status          TEXT NOT NULL DEFAULT 'sent',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conv_id_idx ON messages(conversation_id, created_at);

-- ─── Saved / wishlisted items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  item_type    TEXT NOT NULL DEFAULT 'product',
  target_id    TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  subtitle     TEXT,
  accent_color TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, target_id)
);
CREATE INDEX IF NOT EXISTS saved_items_user_id_idx ON saved_items(user_id);

-- ─── Server-side cart (full-replace sync) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cart_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  variant_id      TEXT NOT NULL,
  saved_for_later BOOLEAN NOT NULL DEFAULT FALSE,
  item_data       JSONB NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, variant_id, saved_for_later)
);
CREATE INDEX IF NOT EXISTS cart_items_user_id_idx ON cart_items(user_id);

-- ─── In-app notification feed ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications_feed (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'system',
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  is_muted        BOOLEAN NOT NULL DEFAULT FALSE,
  actor_name      TEXT,
  actor_handle    TEXT,
  actor_initials  TEXT,
  actor_color     TEXT,
  target_id       TEXT,
  target_type     TEXT,
  cta             TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notif_user_id_idx ON notifications_feed(user_id, created_at DESC);
