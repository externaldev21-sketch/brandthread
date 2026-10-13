-- 261: Notes audience (Instagram Notes "Followers you follow back" / "Close friends").
-- Existing notes keep their current visibility ('followers' = anyone who
-- follows the author); the compose sheet sends 'friends' or 'close_friends'.
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'followers';
