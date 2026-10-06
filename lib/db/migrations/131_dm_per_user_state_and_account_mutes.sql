-- ─── Migration 131: per-user DM state + server-side account mutes ────────────
-- Social E2E (messaging). Three per-membership columns on
-- conversation_participants, same place unread_count / muted_until / pinned_at
-- already live — each side of a conversation archives or deletes ITS OWN copy:
--   archived_at         — Archive: out of the main inbox, into Archived. Was
--                         client-only (AsyncStorage) and reverted on refresh.
--   hidden_at           — Delete for me: gone from my inbox until a NEW message
--                         arrives (cleared on send). Was a hard DELETE of the
--                         whole conversation for BOTH sides.
--   history_cleared_at  — Delete for me also clears my history: I only see
--                         messages after this point if the chat comes back.
-- account_mutes: "Mute" an account (posts, stories, messages notifications)
-- was AsyncStorage-only — it never reached the server, other devices, the
-- feed, or push.
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_cleared_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS account_mutes (
  user_id        TEXT NOT NULL,
  muted_user_id  TEXT NOT NULL,
  mute_posts     BOOLEAN NOT NULL DEFAULT TRUE,
  mute_stories   BOOLEAN NOT NULL DEFAULT TRUE,
  mute_messages  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, muted_user_id)
);
CREATE INDEX IF NOT EXISTS account_mutes_user_idx ON account_mutes (user_id, created_at DESC);
