ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS owner_id TEXT;

UPDATE notification_deliveries
SET owner_id = user_id
WHERE owner_id IS NULL;

ALTER TABLE notification_deliveries
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS notification_deliveries_owner_idx
  ON notification_deliveries (owner_id);

ALTER TABLE notification_events
  ADD COLUMN IF NOT EXISTS owner_id TEXT;

UPDATE notification_events
SET owner_id = user_id
WHERE owner_id IS NULL;

ALTER TABLE notification_events
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS notification_events_owner_idx
  ON notification_events (owner_id);