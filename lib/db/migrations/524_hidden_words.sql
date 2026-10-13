-- Hidden Words (feature 71): a creator's custom words; comments on their posts
-- that contain one are hidden from everyone but the comment's author.
CREATE TABLE IF NOT EXISTS comment_filters (
  user_id     text        PRIMARY KEY,
  hide_custom integer     NOT NULL DEFAULT 1,
  words       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS hidden_by_owner boolean NOT NULL DEFAULT false;
