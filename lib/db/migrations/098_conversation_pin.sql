-- 098: Inbox swipe-row > Pin (item 62).
--
-- Pin is a per-membership setting, exactly like mute (096): NULL means not
-- pinned, a timestamp means pinned since then. Pinning is personal — each
-- side of a conversation can pin/unpin independently of the other.

ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP;
