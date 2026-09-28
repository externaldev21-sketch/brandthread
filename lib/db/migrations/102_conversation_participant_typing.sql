-- ─── Migration 102: per-participant typing indicator ─────────────────────────
-- Real-time "X is typing…" for ordinary (human-to-human) conversations. The
-- only existing typing signal, conversations.agent_typing_until (migration
-- 091), is conversation-level and Brandthread-Agent-only (there is exactly
-- one non-agent sender in that thread). An ordinary DM/group has multiple
-- real senders, so the signal has to live per-membership, on
-- conversation_participants — same place unread_count/last_read_at/muted_until
-- already live. Polled (no websocket layer exists yet — see
-- artifacts/mobile/app/buyer-conversation.tsx), not pushed: the client sets
-- this to a few seconds in the future while the composer has text, clears it
-- on send/blur, and it's read back on the light conversation poll.
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS typing_until TIMESTAMPTZ;
