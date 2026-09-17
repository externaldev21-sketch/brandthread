-- Migration 078: Ad Campaigns
-- Owner-scoped ad campaign drafts with ordered media, CTA enum, formats,
-- budget/duration sliders, payment lifecycle, and estimated reach.

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id                 TEXT NOT NULL,

  -- ── Media ─────────────────────────────────────────────────────────────────
  -- 'video' | 'photos'  — never mixed
  media_kind                TEXT NOT NULL DEFAULT 'photos',
  -- Ordered object storage paths (1 video or 1–5 photos)
  media_object_paths        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Ordered signed-URL-safe public references (resolved at serve time)
  media_mime_types          JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ── Details ───────────────────────────────────────────────────────────────
  headline                  TEXT,
  description               TEXT,
  -- Enum: 'shop_now' | 'learn_more' | 'view_product' | 'sign_up' | 'contact_us'
  cta_kind                  TEXT,
  -- Validated destination (product id, store URL, profile id, or contact URL)
  cta_destination_kind      TEXT,   -- 'product' | 'store' | 'profile' | 'contact'
  cta_destination_id        TEXT,   -- e.g. product UUID or null for store/profile/contact

  -- ── Placement / Formats ───────────────────────────────────────────────────
  -- JSON array of format keys: 'story_9x16' | 'square_1x1' | 'portrait_4x5' | 'landscape_16x9'
  formats                   JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ── Budget / Duration / Reach ─────────────────────────────────────────────
  -- Integer cents: $5 (500) – $1000 (100000)
  budget_cents              INTEGER NOT NULL DEFAULT 500,
  -- Whole days: 1–30
  duration_days             INTEGER NOT NULL DEFAULT 1,
  -- Pre-computed estimate range (low / high), stored at creation, never reported as delivered
  estimated_reach_low       INTEGER NOT NULL DEFAULT 0,
  estimated_reach_high      INTEGER NOT NULL DEFAULT 0,

  -- ── Payment / Lifecycle ───────────────────────────────────────────────────
  -- 'draft' | 'pending_payment' | 'active' | 'failed' | 'cancelled'
  status                    TEXT NOT NULL DEFAULT 'draft',
  -- Idempotency key supplied by the client to prevent duplicate PaymentIntents
  payment_idempotency_key   TEXT UNIQUE,
  stripe_payment_intent_id  TEXT UNIQUE,
  -- Activation timestamps (set only after webhook confirms payment_intent.succeeded)
  paid_at                   TIMESTAMPTZ,
  starts_at                 TIMESTAMPTZ,
  ends_at                   TIMESTAMPTZ,

  -- ── Ad Creative Config ────────────────────────────────────────────────────
  -- JSON blob: { slideshow: { paths: string[] }, formatConfigs: { [format]: { w, h, ar } } }
  creative_config           JSONB,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seller ownership index — list queries always filter by seller_id
CREATE INDEX IF NOT EXISTS ad_campaigns_seller_id_idx
  ON ad_campaigns(seller_id, created_at DESC);

-- Status index for webhook activation queries
CREATE INDEX IF NOT EXISTS ad_campaigns_pi_status_idx
  ON ad_campaigns(stripe_payment_intent_id, status)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- GIN index so media_object_paths can be queried for cleanup
CREATE INDEX IF NOT EXISTS ad_campaigns_media_paths_gin_idx
  ON ad_campaigns USING GIN (media_object_paths);
