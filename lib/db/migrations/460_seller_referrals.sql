-- Seller-to-seller referrals (BT-313): a brand that brings another brand gets
-- a free month on its Brandthread plan, and so does the new brand, once the
-- new brand's first paid month goes through. Config: SELLER_REFERRAL_* env
-- vars (api-server lib/sellerReferrals/config.ts). Separate from the buyer
-- "Give $10, get $10" referrals table.
CREATE TABLE IF NOT EXISTS seller_referrals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id     text NOT NULL,
  invitee_id     text NOT NULL,
  invite_code    text NOT NULL,
  source         text NOT NULL DEFAULT 'link',      -- 'link' | 'code'
  status         text NOT NULL DEFAULT 'pending',   -- 'pending' | 'rewarded' | 'void'
  created_at     timestamptz NOT NULL DEFAULT now(),
  qualified_at   timestamptz,
  -- { method: 'stripe_balance' | 'app_store_manual' | 'capped' | 'none', amountCents, currency, reference }
  inviter_reward jsonb,
  invitee_reward jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_referrals_invitee_unique ON seller_referrals (invitee_id);
CREATE INDEX IF NOT EXISTS seller_referrals_inviter_idx ON seller_referrals (inviter_id, status);
CREATE INDEX IF NOT EXISTS seller_referrals_pending_idx ON seller_referrals (status) WHERE status = 'pending';
