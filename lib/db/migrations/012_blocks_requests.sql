-- 012: Server-side blocks + follow-based message requests
-- blocks:       enforcement table for block/mute (replaces local AsyncStorage-only blocks)
-- is_request:   conversations marked as pending until recipient accepts
-- requested_by: which participant initiated the request (for UI)

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- Lets us quickly look up "who has blocked this user"
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);

-- Follow-based message request status
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_request  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS requested_by TEXT;   -- Clerk userId of the sender who needs acceptance
