-- Migration 090: fix notification_batch_queue.actor_names column type.
--
-- Pre-existing bug found while validating this branch against a fresh
-- database: migration 027 declared this column `json`, but
-- lib/push.ts's enqueueBatchedNotification has always used
-- jsonb_array_length(actor_names) and actor_names || '...'::jsonb, both of
-- which only work on jsonb. Every call to enqueueBatchedNotification (any
-- batched notification: likes, comments, follows...) has been failing with
-- "function jsonb_array_length(json) does not exist" since 027 shipped.
ALTER TABLE notification_batch_queue ALTER COLUMN actor_names TYPE jsonb USING actor_names::jsonb;
