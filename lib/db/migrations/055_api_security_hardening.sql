CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  request_count integer NOT NULL DEFAULT 0,
  window_started_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_expires_at_idx
  ON rate_limit_buckets (expires_at);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  attempt_count integer NOT NULL DEFAULT 1,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  processing_started_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  last_error text
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_started_idx
  ON stripe_webhook_events (status, processing_started_at);