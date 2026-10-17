-- 270: Server-side app settings (privacy, content, accessibility, security).
-- One row per account (Clerk user id) holding a validated JSON object of the
-- settings the buyer Settings screens edit — Read receipts, Activity status,
-- Hide like counts, Personalized recommendations, accessibility, login
-- alerts, etc. Previously these only lived in the phone's AsyncStorage, so
-- nothing on the server could honour them. Keys are validated by the API
-- (artifacts/api-server/src/lib/userAppSettings.ts); unknown keys never land
-- here. Absent row / absent key = the documented default.
CREATE TABLE IF NOT EXISTS user_app_settings (
  user_id    TEXT PRIMARY KEY,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login alerts: the Clerk session ids this account has already signed in
-- with. POST /api/auth/sync records the current session; a session id that
-- is new for an account that already has at least one recorded session is a
-- new sign-in, and (when settings.loginAlerts is on) triggers a security
-- email. The first recorded session never alerts, so existing accounts don't
-- all get an email the first time they open the app after this deploys.
CREATE TABLE IF NOT EXISTS login_alert_sessions (
  user_id    TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);
