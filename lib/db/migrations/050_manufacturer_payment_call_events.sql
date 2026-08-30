CREATE TABLE IF NOT EXISTS manufacturer_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id uuid NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  sample_order_id uuid,
  thread_id uuid REFERENCES manufacturer_threads(id) ON DELETE SET NULL,
  actor_clerk_id text,
  category text NOT NULL,
  type text NOT NULL,
  amount_cents integer,
  provider_event_id text UNIQUE,
  metadata json NOT NULL DEFAULT '{}'::json,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manufacturer_activity_manufacturer_created_idx
  ON manufacturer_activity_events (manufacturer_id, created_at);
CREATE INDEX IF NOT EXISTS manufacturer_activity_sample_order_idx
  ON manufacturer_activity_events (sample_order_id);
CREATE INDEX IF NOT EXISTS manufacturer_activity_thread_idx
  ON manufacturer_activity_events (thread_id);

ALTER TABLE sample_orders
  ADD COLUMN IF NOT EXISTS payment_review_state text NOT NULL DEFAULT 'none';

-- Preserve received-payment history for orders completed before the event
-- ledger existed. Stripe identifiers provide stable reconciliation keys.
INSERT INTO manufacturer_activity_events (
  manufacturer_id, sample_order_id, actor_clerk_id, category, type,
  amount_cents, provider_event_id, metadata, created_at
)
SELECT
  manufacturer_id, id, seller_id, 'payment', 'payment_received',
  price_cents,
  'backfill:' || COALESCE(stripe_transfer_id, stripe_checkout_session_id, stripe_payment_intent_id, id::text),
  json_build_object('source', CASE WHEN stripe_transfer_id IS NOT NULL THEN 'drop_wallet' ELSE 'stripe_checkout' END,
                    'orderType', order_type),
  updated_at
FROM sample_orders
WHERE status <> 'pending_payment'
  AND (stripe_transfer_id IS NOT NULL OR stripe_checkout_session_id IS NOT NULL OR stripe_payment_intent_id IS NOT NULL)
ON CONFLICT (provider_event_id) DO NOTHING;