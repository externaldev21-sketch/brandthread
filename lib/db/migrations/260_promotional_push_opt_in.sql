-- 260: Promotional push opt-in (App Store Review Guideline 4.5.4).
-- Promotional/marketing pushes require an explicit opt-in that is separate
-- from the transactional category toggles. Every existing and new user
-- defaults to NOT opted in; only an explicit toggle in Settings -> Notifications
-- sets it true.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS promo_push_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
