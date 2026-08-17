-- ─── Migration 021: Freelancer Marketplace (Community tab) ──────────────────
-- Freelancer profiles, escrow-paid jobs, and reviews (schema only, no UI yet).
--
-- Payment model: hirer pays the full agreed price via Stripe Checkout — the
-- charge lands on the platform account (separate charges & transfers). The 5%
-- platform fee (PLATFORM_COMMISSION_RATE) is recorded at creation time; the
-- net amount is transferred to the freelancer's Connect Express account via
-- a Stripe transfer when the job is marked complete.

-- 1. Freelancer profiles (one per user, keyed on Clerk user id)
CREATE TABLE IF NOT EXISTS freelancers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL UNIQUE REFERENCES users(clerk_id) ON DELETE CASCADE,
  -- 'graphic_design' | 'copywriting' | 'social_media' | 'photography'
  -- | 'video_editing' | 'web_design' | 'branding'
  service_type          TEXT NOT NULL,
  skill_tags            JSONB NOT NULL DEFAULT '[]',
  hourly_rate_cents     INTEGER NOT NULL DEFAULT 0,
  bio                   TEXT NOT NULL DEFAULT '',
  portfolio_urls        JSONB NOT NULL DEFAULT '[]',   -- up to 4 links
  -- Stripe Connect Express — freelancer receives payouts here
  stripe_account_id     TEXT,
  stripe_account_status TEXT,                          -- 'pending' | 'active' | 'restricted'
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  total_jobs_completed  INTEGER NOT NULL DEFAULT 0,
  avg_rating_tenths     INTEGER NOT NULL DEFAULT 0,    -- 0 = unrated; 10–50 = 1.0–5.0 stars
  created_at            TIMESTAMP NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS freelancers_service_type_idx   ON freelancers(service_type);
CREATE INDEX IF NOT EXISTS freelancers_active_idx         ON freelancers(is_active);
CREATE INDEX IF NOT EXISTS freelancers_stripe_account_idx ON freelancers(stripe_account_id);

-- 2. Freelancer jobs (escrow lifecycle: pending → accepted → in_progress →
--    completed; cancel allowed from pending/accepted with automatic refund)
CREATE TABLE IF NOT EXISTS freelancer_jobs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id              UUID NOT NULL REFERENCES freelancers(id) ON DELETE CASCADE,
  seller_id                  TEXT NOT NULL,   -- Clerk user id of the hirer
  title                      TEXT NOT NULL,
  description                TEXT NOT NULL DEFAULT '',
  agreed_price_cents         INTEGER NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | in_progress | completed | cancelled
  payment_status             TEXT NOT NULL DEFAULT 'unpaid',   -- unpaid | paid | refunded
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id   TEXT,
  stripe_transfer_id         TEXT,            -- set when the completion payout is sent
  platform_fee_cents         INTEGER NOT NULL DEFAULT 0,
  freelancer_payout_cents    INTEGER NOT NULL DEFAULT 0,
  completed_at               TIMESTAMP,
  created_at                 TIMESTAMP NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS freelancer_jobs_freelancer_idx ON freelancer_jobs(freelancer_id);
CREATE INDEX IF NOT EXISTS freelancer_jobs_seller_idx     ON freelancer_jobs(seller_id);
CREATE INDEX IF NOT EXISTS freelancer_jobs_status_idx     ON freelancer_jobs(status);
CREATE UNIQUE INDEX IF NOT EXISTS freelancer_jobs_checkout_session_idx
  ON freelancer_jobs(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- 3. Freelancer reviews (schema only — UI ships in a later iteration)
CREATE TABLE IF NOT EXISTS freelancer_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID NOT NULL UNIQUE REFERENCES freelancer_jobs(id) ON DELETE CASCADE,
  freelancer_id    UUID NOT NULL REFERENCES freelancers(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL,   -- Clerk user id
  rating_tenths    INTEGER NOT NULL CHECK (rating_tenths BETWEEN 1 AND 50),
  comment          TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMP NOT NULL DEFAULT now(),
  updated_at       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS freelancer_reviews_freelancer_idx ON freelancer_reviews(freelancer_id);
