-- 457: Moderation queue actions + moderator alerts (Revenue P1 5/7, BT-369).
--
-- user_moderation_actions: warnings, temporary/permanent suspensions and bans
-- applied from the moderation queue. A temporary suspension carries ends_at;
-- the moderation-alerts job lifts it when that passes.
CREATE TABLE IF NOT EXISTS user_moderation_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('warn', 'suspend', 'ban')),
  reason         text,
  report_id      uuid,
  ends_at        timestamptz,
  actor_clerk_id text NOT NULL,
  lifted_at      timestamptz,
  lifted_by      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_moderation_actions_user_idx ON user_moderation_actions (user_id, created_at);
CREATE INDEX IF NOT EXISTS user_moderation_actions_expiry_idx ON user_moderation_actions (ends_at)
  WHERE kind = 'suspend' AND lifted_at IS NULL AND ends_at IS NOT NULL;

-- One escalation per report: reports still open after 12 hours re-alert once.
CREATE TABLE IF NOT EXISTS report_escalations (
  report_id    uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  escalated_at timestamptz NOT NULL DEFAULT now()
);

-- Alert throttle: bursts of new reports collapse into one alert per window.
CREATE TABLE IF NOT EXISTS moderation_alert_state (
  id            text PRIMARY KEY DEFAULT 'default',
  last_sent_at  timestamptz,
  pending_count integer NOT NULL DEFAULT 0,
  pending_since timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
