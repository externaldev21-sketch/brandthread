-- ─── Migration 129: interactive story stickers ───────────────────────────────
-- story_poll_votes: one vote per (story, poll sticker, user).
-- story_question_answers: one answer per (story, question sticker, user),
-- readable only by the story's author.
CREATE TABLE IF NOT EXISTS story_poll_votes (
  story_id     UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  overlay_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, overlay_id, user_id)
);
CREATE INDEX IF NOT EXISTS story_poll_votes_story_idx ON story_poll_votes (story_id, overlay_id);

CREATE TABLE IF NOT EXISTS story_question_answers (
  story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  overlay_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  answer     TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, overlay_id, user_id)
);
CREATE INDEX IF NOT EXISTS story_question_answers_story_idx ON story_question_answers (story_id, created_at);
