CREATE TABLE IF NOT EXISTS stripe_trial_warning_events (
  event_id text PRIMARY KEY,
  recorded_at timestamp with time zone NOT NULL DEFAULT now()
);