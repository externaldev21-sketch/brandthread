-- 340: Account-scoped app settings (privacy, notification, media, appearance,
-- accessibility toggles and a few profile extras such as pronouns/gender).
-- One row per Clerk user; `settings` is a shallow JSON object whose keys are
-- allowlisted and type-checked by the API (artifacts/api-server/src/lib/userSettings.ts).
-- The app keeps a per-account local cache and treats this row as the source of
-- truth so settings follow the account across devices. Erased with the account
-- (lib/accountDeletion.ts).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT PRIMARY KEY,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
