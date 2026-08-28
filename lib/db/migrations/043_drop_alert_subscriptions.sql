CREATE TABLE IF NOT EXISTS drop_alert_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS drop_alert_subscriptions_drop_user_unique
  ON drop_alert_subscriptions(drop_id, user_id);

CREATE INDEX IF NOT EXISTS drop_alert_subscriptions_user_idx
  ON drop_alert_subscriptions(user_id);