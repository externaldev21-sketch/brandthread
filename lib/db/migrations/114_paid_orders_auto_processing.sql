-- Orders are automatic: a paid order is "processing" (To ship) from the moment
-- payment succeeds, with no seller "accept" step. Existing paid orders still
-- waiting for acceptance move to the same state. Idempotent.
UPDATE orders
   SET status = 'processing', updated_at = now()
 WHERE status = 'pending'
   AND paid_at IS NOT NULL
   AND stripe_payment_intent_id IS NOT NULL;
