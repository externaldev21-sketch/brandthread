CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  push_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_message_id TEXT,
  provider_status TEXT,
  provider_error TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  provider_result_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_deliveries_notification_token_unique
    UNIQUE (notification_id, push_token)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_user_idx
  ON notification_deliveries (user_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_notification_idx
  ON notification_deliveries (notification_id);

CREATE TABLE IF NOT EXISTS notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  delivery_id UUID REFERENCES notification_deliveries(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_events_user_idx
  ON notification_events (user_id);
CREATE INDEX IF NOT EXISTS notification_events_notification_idx
  ON notification_events (notification_id);