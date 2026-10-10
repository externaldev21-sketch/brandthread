-- 281: Notification settings "Pause all" + multi-account push.
--
-- users.push_paused_until: Settings → Notifications → Pause all (15 min to
-- 8 hours). While it is in the future no push is sent; the in-app Activity
-- feed is unaffected.
--
-- push_tokens: one device can be signed in to several accounts (account
-- switcher), and each of them should still get its own pushes, labelled with
-- the account they are for. The token was unique on its own, so registering
-- for the second account took it away from the first. It is now unique per
-- (token, user_id). Registration prunes accounts that are no longer signed in
-- on that device (api-server routes/push.ts).
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_paused_until TIMESTAMP;

ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_token_key;
ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_token_unique;
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_user_unique ON push_tokens (token, user_id);
CREATE INDEX IF NOT EXISTS push_tokens_token_idx ON push_tokens (token);
