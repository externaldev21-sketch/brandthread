-- ─── Migration 305: native call ringing tokens (VoIP push) ─────────────────
-- Device tokens used to ring the system call UI for 1:1 DM calls when the
-- app is in the background or killed (artifacts/api-server/src/lib/voipPush.ts):
--   • iOS     kind 'voip' — a PushKit token; APNs VoIP push (topic <bundle>.voip)
--             reported straight to CallKit by the app's AppDelegate.
--   • Android kind 'fcm'  — the raw FCM registration token; a high-priority
--             FCM HTTP v1 DATA message wakes the app, which shows the call
--             through ConnectionService (react-native-callkeep, self-managed).
-- Separate from push_tokens (Expo push tokens for ordinary notifications).
-- A token belongs to one account at a time (re-registering on a shared
-- device moves it). APNs 410 / BadDeviceToken and FCM UNREGISTERED delete
-- the row. Idempotent.

CREATE TABLE IF NOT EXISTS call_push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  platform    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  token       TEXT NOT NULL,
  -- iOS: the app's bundle identifier (APNs topic is "<bundle_id>.voip").
  bundle_id   TEXT,
  -- iOS: 'sandbox' (development builds) or 'production' (TestFlight / App Store).
  environment TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT call_push_tokens_platform_valid CHECK (platform IN ('ios', 'android')),
  CONSTRAINT call_push_tokens_kind_valid CHECK (kind IN ('voip', 'fcm')),
  CONSTRAINT call_push_tokens_environment_valid
    CHECK (environment IS NULL OR environment IN ('sandbox', 'production'))
);

CREATE UNIQUE INDEX IF NOT EXISTS call_push_tokens_token_idx
  ON call_push_tokens (token);

CREATE INDEX IF NOT EXISTS call_push_tokens_user_idx
  ON call_push_tokens (user_id);
