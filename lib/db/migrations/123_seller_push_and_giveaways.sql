-- ─── Migration 123: seller follower push broadcasts + giveaways ──────────────
-- seller_push_broadcasts: one row per broadcast a seller sends to their
-- followers. The row is also the rate-limit claim: it is inserted inside a
-- per-seller advisory-lock transaction that first checks no earlier row exists
-- in the trailing 24 hours, so concurrent requests cannot both send.

CREATE TABLE IF NOT EXISTS seller_push_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deeplink_type TEXT,
  deeplink_id TEXT,
  status TEXT NOT NULL DEFAULT 'sending',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS seller_push_broadcasts_seller_created_idx
  ON seller_push_broadcasts (seller_id, created_at DESC);

-- Giveaways ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS giveaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  share_code TEXT NOT NULL,
  title TEXT NOT NULL,
  prize_text TEXT NOT NULL,
  product_id UUID,
  post_id UUID,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  rules_text TEXT NOT NULL,
  eligibility TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  winner_count INTEGER NOT NULL DEFAULT 1,
  -- 'open' | 'drawn' | 'cancelled'. "Live" / "ended" are derived from the
  -- dates so a giveaway ends on time without a background job.
  status TEXT NOT NULL DEFAULT 'open',
  drawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS giveaways_share_code_idx ON giveaways (share_code);
CREATE INDEX IF NOT EXISTS giveaways_seller_idx ON giveaways (seller_id, created_at DESC);

-- Entries are derived from REAL follows + post_comments rows, materialised at
-- draw time and whenever an entrant views the giveaway. One row per person.
CREATE TABLE IF NOT EXISTS giveaway_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id UUID NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  followed BOOLEAN NOT NULL DEFAULT FALSE,
  commented BOOLEAN NOT NULL DEFAULT FALSE,
  comment_id UUID,
  eligible BOOLEAN NOT NULL DEFAULT FALSE,
  excluded_reason TEXT,
  materialised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (giveaway_id, user_id)
);
CREATE INDEX IF NOT EXISTS giveaway_entries_giveaway_eligible_idx
  ON giveaway_entries (giveaway_id, eligible);

-- Audit log: one row per draw / redraw. Stores a hash of the sorted eligible
-- entrant ids (not a seed — the draw uses crypto.randomInt), when it ran, and
-- who won.
CREATE TABLE IF NOT EXISTS giveaway_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id UUID NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  draw_number INTEGER NOT NULL,
  eligible_count INTEGER NOT NULL,
  eligible_hash TEXT NOT NULL,
  winner_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  drawn_by TEXT NOT NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (giveaway_id, draw_number)
);

CREATE TABLE IF NOT EXISTS giveaway_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id UUID NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  draw_id UUID NOT NULL REFERENCES giveaway_draws(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  -- 'active' | 'replaced'
  status TEXT NOT NULL DEFAULT 'active',
  replaced_reason TEXT,
  replaced_at TIMESTAMPTZ,
  replaces_winner_id UUID,
  notified_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS giveaway_winners_giveaway_idx ON giveaway_winners (giveaway_id, status);
-- A person can hold at most one ACTIVE win per giveaway.
CREATE UNIQUE INDEX IF NOT EXISTS giveaway_winners_active_user_idx
  ON giveaway_winners (giveaway_id, user_id) WHERE status = 'active';
