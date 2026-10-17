-- 315: Items 93-95 — per-viewer chat archive, "delete chat for me",
-- "delete message for me", and carrying legacy chat mutes over to the column
-- push suppression actually reads.

-- Inbox Archive: per-membership, like pinned_at (098). NULL = in the main
-- inbox. Cleared for the recipient when a new message arrives.
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;

-- Inbox swipe Delete = delete for me: hides the conversation and every
-- message up to this moment for this viewer only.
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP;

-- Message "Delete for me": one row per (message, viewer).
CREATE TABLE IF NOT EXISTS message_hidden (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_hidden_user_idx ON message_hidden (user_id);

-- The legacy PATCH /:id/mute { muted } handler only ever set is_muted, which
-- nothing reads for notification suppression. Carry any such mute over to
-- muted_until as "until I turn it back on" (the same far-future sentinel the
-- route uses), so a chat someone muted actually stays quiet. Idempotent.
UPDATE conversation_participants
   SET muted_until = '9999-12-31 00:00:00'
 WHERE is_muted = true AND muted_until IS NULL;
