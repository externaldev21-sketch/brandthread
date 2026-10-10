-- 456: Admin money tools (Revenue P1 4/7, BT-468 / BT-471).
-- One row per connected account (seller or manufacturer) whose payouts the
-- platform controls: the default new-account payout delay, an admin hold
-- (Stripe payout schedule set to manual), or a release of either. The
-- Thread Cash kill switches (BT-448) live in the existing feature_flags table
-- (keys threadCashRewardsPaused / threadCashCheckoutPaused), so they need no
-- schema here.
CREATE TABLE IF NOT EXISTS payout_controls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type        text NOT NULL CHECK (party_type IN ('seller', 'manufacturer')),
  party_id          text NOT NULL,
  stripe_account_id text,
  state             text NOT NULL DEFAULT 'new_account_delay'
                    CHECK (state IN ('new_account_delay', 'held', 'released')),
  delay_days        integer,
  delay_until       timestamptz,
  previous_schedule jsonb,
  reason            text,
  held_by           text,
  held_at           timestamptz,
  released_by       text,
  released_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_controls_party_unique UNIQUE (party_type, party_id)
);

CREATE INDEX IF NOT EXISTS payout_controls_state_idx ON payout_controls (state, delay_until);
