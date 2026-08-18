-- Migration 027: notification digest preference on users
-- Allows sellers/buyers to choose realtime vs daily digest push notifications.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_digest varchar(20) NOT NULL DEFAULT 'realtime';

-- Valid values: 'realtime' | 'daily'
-- 'realtime' = individual push per event (default, existing behaviour)
-- 'daily'    = one summary push per day, batched by the notification job
