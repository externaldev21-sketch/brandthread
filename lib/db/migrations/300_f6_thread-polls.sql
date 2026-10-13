-- F6 item 77: polls on Threads (X/Twitter poll pattern). One vote per person,
-- no changing it; the poll ends `duration_minutes` after the post goes live.
CREATE TABLE IF NOT EXISTS post_polls (
  post_id          uuid        PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  options          jsonb       NOT NULL,
  duration_minutes integer     NOT NULL DEFAULT 1440,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_poll_votes (
  post_id      uuid        NOT NULL REFERENCES post_polls(post_id) ON DELETE CASCADE,
  user_id      text        NOT NULL,
  option_index integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_poll_votes_option_idx ON post_poll_votes (post_id, option_index);
