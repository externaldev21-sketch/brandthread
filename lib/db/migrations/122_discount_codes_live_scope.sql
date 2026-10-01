-- 122: Live-only discount codes. A code with live_stream_id set is valid only
-- for that stream and only while it is live; enforced server-side in
-- lib/discounts.ts validateDiscountCode. NULL = a normal store code.
-- Additive and idempotent.

ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS live_stream_id UUID;

CREATE INDEX IF NOT EXISTS discount_codes_live_stream_idx
  ON discount_codes (live_stream_id) WHERE live_stream_id IS NOT NULL;
