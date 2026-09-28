-- 096: Chat details — nicknames and per-participant mute (DM flows PR 2).
--
-- Nicknames are conversation-scoped, keyed by "<viewerUserId>:<targetUserId>"
-- in a jsonb map on the conversation itself (one map serves every
-- participant's nickname settings for every other participant, without a
-- join table) — mirrors Instagram's "nicknames are per-chat, set by you,
-- for one other person" model and scales to a future group chat without a
-- schema change.
--
-- Mute is a per-membership setting (already how unread_count/last_read_at
-- work on conversation_participants): NULL means not muted, a timestamp in
-- the past or future means muted until then, and a far-future sentinel
-- (9999-12-31) represents "Until I turn it back on".

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS nicknames JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP;
