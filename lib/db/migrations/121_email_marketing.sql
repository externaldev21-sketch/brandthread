-- ─── Migration 121: Seller email marketing ────────────────────────────────────
-- Email list capture (public store signup), campaigns, and per-recipient sends.
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS email_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'store_site',
  -- subscribed | pending (awaiting double opt-in) | unsubscribed | bounced | complained
  status TEXT NOT NULL DEFAULT 'subscribed',
  unsubscribe_token TEXT NOT NULL,
  consent_at TIMESTAMPTZ,
  consent_ip_hash TEXT,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_subscribers_seller_email_uidx
  ON email_subscribers (seller_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS email_subscribers_token_uidx
  ON email_subscribers (unsubscribe_token);
CREATE INDEX IF NOT EXISTS email_subscribers_seller_created_idx
  ON email_subscribers (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_settings (
  seller_id TEXT PRIMARY KEY,
  from_name TEXT,
  reply_to TEXT,
  postal_address TEXT,
  double_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  body JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- subscribers | customers | followers
  audience TEXT NOT NULL DEFAULT 'subscribers',
  -- draft | scheduled | sending | sent
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_campaigns_seller_idx
  ON email_campaigns (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_campaigns_due_idx
  ON email_campaigns (status, scheduled_at);

CREATE TABLE IF NOT EXISTS email_campaign_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  subscriber_id UUID NOT NULL,
  email TEXT NOT NULL,
  -- queued | sending | sent | failed | skipped
  status TEXT NOT NULL DEFAULT 'queued',
  claimed_at TIMESTAMPTZ,
  provider_message_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_campaign_sends_campaign_sub_uidx
  ON email_campaign_sends (campaign_id, subscriber_id);
CREATE INDEX IF NOT EXISTS email_campaign_sends_status_idx
  ON email_campaign_sends (campaign_id, status);
CREATE INDEX IF NOT EXISTS email_campaign_sends_seller_sent_idx
  ON email_campaign_sends (seller_id, sent_at);
CREATE INDEX IF NOT EXISTS email_campaign_sends_provider_idx
  ON email_campaign_sends (provider_message_id);
