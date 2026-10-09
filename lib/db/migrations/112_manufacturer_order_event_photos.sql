-- 112: Production-milestone photo updates. A manufacturer can post progress
-- photos against the order's current stage without changing its status (a
-- same-stage event: fromStatus = toStatus). Additive column, default '[]'
-- keeps every existing event and every other reader of this table unchanged.
ALTER TABLE manufacturer_order_events
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
