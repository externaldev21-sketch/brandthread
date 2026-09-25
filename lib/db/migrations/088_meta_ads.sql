-- ─── Migration 088: Meta Ads (Facebook + Instagram) ───────────────────────────
-- Seller-owned Meta ad accounts connected via OAuth, campaigns launched
-- through Brandthread's Create Ad flow onto the real Meta Marketing API, and
-- a Conversions API event log for pixel dedup. Brandthread never handles ad
-- spend — Meta bills the seller's own ad account payment method.

CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id                TEXT        NOT NULL UNIQUE,

  meta_user_id             TEXT,
  meta_user_name           TEXT,

  access_token_encrypted   TEXT        NOT NULL,
  token_expires_at         TIMESTAMPTZ,
  scopes                   JSONB       NOT NULL DEFAULT '[]',

  business_id              TEXT,
  business_name            TEXT,
  ad_account_id             TEXT,
  ad_account_name          TEXT,
  ad_account_currency      TEXT,
  page_id                  TEXT,
  page_name                TEXT,
  instagram_actor_id       TEXT,
  instagram_username       TEXT,
  pixel_id                 TEXT,

  status                   TEXT        NOT NULL DEFAULT 'pending_selection', -- pending_selection|connected|needs_reauth|disconnected
  last_error               TEXT,
  connected_at             TIMESTAMPTZ,
  disconnected_at          TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_campaigns (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id             TEXT        NOT NULL,
  ad_account_record_id  UUID        NOT NULL REFERENCES meta_ad_accounts(id),
  local_ad_campaign_id  UUID        REFERENCES ad_campaigns(id),

  promote_kind          TEXT        NOT NULL, -- product|store|video
  promote_ref_id        TEXT,

  objective             TEXT        NOT NULL, -- sales|traffic|awareness
  meta_objective        TEXT        NOT NULL, -- OUTCOME_SALES|OUTCOME_TRAFFIC|OUTCOME_AWARENESS

  primary_text          TEXT,
  headline              TEXT,
  cta_type               TEXT        NOT NULL DEFAULT 'SHOP_NOW',
  destination_url       TEXT        NOT NULL,

  media_kind            TEXT        NOT NULL DEFAULT 'photos',
  media_object_paths    JSONB       NOT NULL DEFAULT '[]',

  budget_type           TEXT        NOT NULL DEFAULT 'daily', -- daily|lifetime
  budget_cents          INTEGER     NOT NULL,
  start_time            TIMESTAMPTZ,
  end_time              TIMESTAMPTZ,

  advantage_plus        BOOLEAN     NOT NULL DEFAULT TRUE,
  placements            JSONB       NOT NULL DEFAULT '{}',
  targeting_spec        JSONB       NOT NULL DEFAULT '{}',

  status                TEXT        NOT NULL DEFAULT 'draft', -- draft|launching|in_review|active|paused|rejected|completed|failed|archived
  rejection_reason      TEXT,

  idempotency_key       TEXT        NOT NULL UNIQUE,

  meta_campaign_id      TEXT,
  meta_ad_set_id        TEXT,
  meta_creative_id      TEXT,
  meta_ad_id            TEXT,

  last_synced_at        TIMESTAMPTZ,
  launched_at           TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS meta_campaigns_seller_id_idx ON meta_campaigns(seller_id, created_at);
CREATE INDEX IF NOT EXISTS meta_campaigns_meta_campaign_id_idx ON meta_campaigns(meta_campaign_id);

CREATE TABLE IF NOT EXISTS meta_campaign_insights (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id            UUID        NOT NULL REFERENCES meta_campaigns(id),

  spend_cents            INTEGER     NOT NULL DEFAULT 0,
  impressions            INTEGER     NOT NULL DEFAULT 0,
  reach                  INTEGER     NOT NULL DEFAULT 0,
  clicks                 INTEGER     NOT NULL DEFAULT 0,
  ctr                    NUMERIC(8,4),
  cpc_cents              INTEGER,
  purchases              INTEGER     NOT NULL DEFAULT 0,
  purchase_value_cents   INTEGER     NOT NULL DEFAULT 0,
  roas                   NUMERIC(10,4),

  fetched_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_campaign_insights_campaign_id_unique ON meta_campaign_insights(campaign_id);

CREATE TABLE IF NOT EXISTS meta_conversion_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id             TEXT        NOT NULL,
  event_id              TEXT        NOT NULL,
  event_name            TEXT        NOT NULL, -- ViewContent|AddToCart|InitiateCheckout|Purchase
  occurred_at           TIMESTAMPTZ NOT NULL,
  product_id            TEXT,
  value_cents           INTEGER,
  currency              TEXT        DEFAULT 'USD',

  sent_to_meta          BOOLEAN     NOT NULL DEFAULT FALSE,
  meta_response_status  TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_conversion_events_dedup_unique
  ON meta_conversion_events(seller_id, event_id, event_name);

INSERT INTO feature_flags (key, enabled, description)
VALUES
  ('metaAds', true, 'Meta (Facebook + Instagram) ads connect and campaign launch from Create Ad')
ON CONFLICT (key) DO NOTHING;
