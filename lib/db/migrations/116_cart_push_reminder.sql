-- Marks the 1-hour cart push reminder separately from the 24-hour
-- notified_abandoned_at marker, so each abandonment window is reminded once
-- per channel.
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS push_reminded_at TIMESTAMP;
