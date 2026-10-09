-- 120: Pinned product on a live stream. `pinned_product_id` is the product the
-- seller is selling right now (shown as the on-screen Buy card). `pin_updated_at`
-- distinguishes "never pinned" (NULL: clients fall back to the legacy
-- highlighted tag) from "seller explicitly unpinned" (set, pinned_product_id NULL).
-- Additive and idempotent.

ALTER TABLE live_streams
  ADD COLUMN IF NOT EXISTS pinned_product_id TEXT,
  ADD COLUMN IF NOT EXISTS pin_updated_at TIMESTAMPTZ;
