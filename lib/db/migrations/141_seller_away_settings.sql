-- ─── Migration 141: Seller away auto-reply settings ──────────────────────────
-- One row per seller. `mode`: 'always' (reply whenever enabled) or
-- 'outside_hours' (reply outside the weekly business hours below, evaluated
-- in `timezone`). `open_days` is a 7-bit mask (bit 0 = Sunday ... bit 6 =
-- Saturday); `open_minute`/`close_minute` are minutes from local midnight
-- (close < open means the hours run overnight; equal means open all day).
CREATE TABLE IF NOT EXISTS seller_away_settings (
  seller_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'always',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  open_days INTEGER NOT NULL DEFAULT 62,
  open_minute INTEGER NOT NULL DEFAULT 540,
  close_minute INTEGER NOT NULL DEFAULT 1020,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
