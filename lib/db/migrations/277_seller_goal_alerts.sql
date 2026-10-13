-- 277: Goal alerts (seller analytics goals, migration 121).
-- One row per alert actually sent, so the goal alert job notifies a seller at
-- most once per goal, kind and period: "reached" once when the goal is hit,
-- "behind" once when pace drops below 80% of target after half the period.
-- target_value is part of the key so editing a goal's target re-arms it once.
CREATE TABLE IF NOT EXISTS seller_goal_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id       UUID NOT NULL,
  seller_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  period_start  TIMESTAMP NOT NULL,
  target_value  INTEGER NOT NULL,
  actual_value  INTEGER NOT NULL,
  sent_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_goal_alerts_once_idx
  ON seller_goal_alerts (goal_id, kind, period_start, target_value);
CREATE INDEX IF NOT EXISTS seller_goal_alerts_seller_idx
  ON seller_goal_alerts (seller_id, sent_at);
