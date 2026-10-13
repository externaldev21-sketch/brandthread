-- F6 item 76: "Pin to your profile" (Instagram pattern) — up to 3 pinned posts per author.
CREATE TABLE IF NOT EXISTS post_pins (
  post_id   uuid        PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  user_id   text        NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_pins_user_idx ON post_pins (user_id, pinned_at);
