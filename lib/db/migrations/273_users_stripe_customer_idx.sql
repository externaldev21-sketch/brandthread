-- Every Stripe subscription/invoice webhook finds the seller by
-- users.stripe_customer_id (webhooks.ts handleSubscriptionUpdated and
-- friends); without an index each event scanned the users table.
CREATE INDEX IF NOT EXISTS users_stripe_customer_id_idx
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
