-- 263: Idempotent message sends.
-- The mobile app's offline outbox retries a message send after a dropped
-- connection. Each outgoing message carries a client-generated id; a retry of
-- a send the server already stored returns the existing row instead of
-- inserting a duplicate. Nullable: sends without an id behave as before.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS messages_client_message_id_uniq
  ON messages (conversation_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
