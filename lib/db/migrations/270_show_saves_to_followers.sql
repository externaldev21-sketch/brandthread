-- "Saved by people you follow" line on the product page. A person can turn
-- this off in Privacy; saves filed in a private collection never count.
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_saves_to_followers BOOLEAN NOT NULL DEFAULT TRUE;

-- Lookup is "who saved product X", filtered to the viewer's follows.
CREATE INDEX IF NOT EXISTS saved_items_target_id_user_id_idx ON saved_items (target_id, user_id);
