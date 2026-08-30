-- Participant-specific unread state for seller/manufacturer conversations.
ALTER TABLE manufacturer_threads
  ADD COLUMN IF NOT EXISTS seller_unread_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manufacturer_threads
  ADD COLUMN IF NOT EXISTS manufacturer_unread_count INTEGER NOT NULL DEFAULT 0;

-- The legacy counter represented the manufacturer's inbox.
UPDATE manufacturer_threads
SET manufacturer_unread_count = unread_count
WHERE manufacturer_unread_count = 0 AND unread_count > 0;

-- Merge old duplicate participant threads before enforcing the invariant.
-- All dependent rows retain their data by moving to the oldest thread.
DO $$
DECLARE duplicate_record RECORD;
BEGIN
  FOR duplicate_record IN
    SELECT id, manufacturer_id, buyer_clerk_id,
      first_value(id) OVER (PARTITION BY manufacturer_id, buyer_clerk_id ORDER BY created_at, id) AS canonical_id
    FROM manufacturer_threads
  LOOP
    IF duplicate_record.id <> duplicate_record.canonical_id THEN
      UPDATE manufacturer_messages SET thread_id = duplicate_record.canonical_id WHERE thread_id = duplicate_record.id;
      UPDATE sample_orders SET thread_id = duplicate_record.canonical_id WHERE thread_id = duplicate_record.id;
      DELETE FROM manufacturer_threads WHERE id = duplicate_record.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS manufacturer_threads_participants_unique
  ON manufacturer_threads(manufacturer_id, buyer_clerk_id);

CREATE TABLE IF NOT EXISTS manufacturer_thread_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES manufacturer_threads(id) ON DELETE CASCADE,
  uploader_clerk_id TEXT NOT NULL,
  object_path TEXT NOT NULL UNIQUE,
  consumed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufacturer_thread_attachments_thread_uploader_idx
  ON manufacturer_thread_attachments(thread_id, uploader_clerk_id, consumed_at);

ALTER TABLE sample_orders
  ADD COLUMN IF NOT EXISTS wallet_payment_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE sample_orders
  ADD COLUMN IF NOT EXISTS wallet_payment_attempt_key TEXT;
ALTER TABLE sample_orders
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sample_orders_checkout_session_unique
  ON sample_orders(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
ALTER TABLE sample_orders
  ADD COLUMN IF NOT EXISTS checkout_session_version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS drop_wallet_transactions_bulk_payment_sample_order_unique
  ON drop_wallet_transactions(sample_order_id)
  WHERE type = 'bulk_payment' AND sample_order_id IS NOT NULL;
