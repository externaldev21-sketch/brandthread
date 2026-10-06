-- ─── Migration 121: Seller analytics reports ─────────────────────────────────
-- store_visits.device: which client recorded the visit ('ios' | 'android' |
--   'web'), sent by the app or sniffed from the User-Agent server-side. Feeds
--   the Audience report's device split. Nullable: rows recorded before this
--   migration simply have no device.
-- seller_goal_targets: several goals per seller (revenue / orders / visits /
--   followers / units for the current week / month / quarter / year). Replaces
--   the single-row seller_goals table from migration 120; any existing row is
--   carried over once (idempotent) and the old table is left untouched.

ALTER TABLE store_visits ADD COLUMN IF NOT EXISTS device TEXT;

CREATE TABLE IF NOT EXISTS seller_goal_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'month',
  target_value INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_goal_targets_metric_check CHECK (metric IN ('revenue', 'orders', 'visits', 'followers', 'units')),
  CONSTRAINT seller_goal_targets_period_check CHECK (period IN ('week', 'month', 'quarter', 'year')),
  CONSTRAINT seller_goal_targets_target_check CHECK (target_value > 0)
);

CREATE INDEX IF NOT EXISTS seller_goal_targets_seller_created_idx
  ON seller_goal_targets (seller_id, created_at);

INSERT INTO seller_goal_targets (seller_id, metric, period, target_value, created_at, updated_at)
SELECT g.seller_id, g.metric, 'month', g.target_value, g.created_at, g.updated_at
FROM seller_goals g
WHERE NOT EXISTS (SELECT 1 FROM seller_goal_targets t WHERE t.seller_id = g.seller_id);
