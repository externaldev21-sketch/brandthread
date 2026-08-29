CREATE TABLE IF NOT EXISTS seller_subscription_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  provider text NOT NULL,
  plan_id text NOT NULL DEFAULT 'starter',
  status text NOT NULL DEFAULT 'expired',
  expires_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  is_sandbox boolean NOT NULL DEFAULT false,
  product_identifier text,
  provider_updated_at timestamp with time zone,
  last_synced_at timestamp with time zone NOT NULL DEFAULT now(),
  provider_data json,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_subscription_entitlements_provider_user_unique
  ON seller_subscription_entitlements(provider, clerk_user_id);
CREATE INDEX IF NOT EXISTS seller_subscription_entitlements_user_status_idx
  ON seller_subscription_entitlements(clerk_user_id, status);

CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  event_type text,
  app_user_id text,
  occurred_at timestamp with time zone,
  received_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS revenuecat_webhook_events_event_id_unique
  ON revenuecat_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS revenuecat_webhook_events_app_user_idx
  ON revenuecat_webhook_events(app_user_id, received_at);