-- 318: "tagged you" is sent once per person per post. post_user_tags records
-- when that alert went out so later edits / archive-restore / a cleared
-- notification never re-send it. Rows that already exist are treated as
-- notified (no surprise alerts for old tags after deploy).
ALTER TABLE post_user_tags ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP;
UPDATE post_user_tags SET notified_at = created_at WHERE notified_at IS NULL;
