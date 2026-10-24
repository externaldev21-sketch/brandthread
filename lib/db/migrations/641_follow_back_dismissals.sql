-- Dismissed "Follow back" prompts: the viewer hid the follow-back suggestion
-- for one of their followers (GET/POST /api/social/follow-back-dismissals).
CREATE TABLE IF NOT EXISTS follow_back_dismissals (
  user_id           text NOT NULL,
  dismissed_user_id text NOT NULL,
  created_at        timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_user_id)
);
