-- 097: Chat themes and disappearing messages (DM flows PR 3).
--
-- Theme and disappearing-messages state are conversation-level properties
-- (both participants see the same background/bubble colors and the same
-- disappearing state — never per-user), so both live on `conversations`.
--
-- Disappearing messages uses an opportunistic sweep, not a cron job: when a
-- message is marked read while disappearing is on, disappear_at is set to
-- 24h from now (matching Instagram's own copy: "disappear after they've
-- been seen ... 24 hours"); the messages list/read endpoints delete any of
-- this conversation's messages whose disappear_at has passed before
-- returning. See docs/dm-flows.md for the exact reasoning and limitations.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS theme_id TEXT,
  ADD COLUMN IF NOT EXISTS disappearing_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS disappear_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS messages_disappear_at_idx ON messages (disappear_at)
  WHERE disappear_at IS NOT NULL;
