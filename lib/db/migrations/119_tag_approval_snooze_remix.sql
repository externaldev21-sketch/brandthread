-- ─── Migration 119: Tag approval, suggested-post snooze, video remixes ──────
-- Backs three buyer settings rows (buyer-settings-detail.tsx), each enforced
-- by the API (artifacts/api-server/src/lib/interactionSettings.ts + lib/remix.ts):
--   • "Manually approve tags" / "Pending tags": new people tags (post_user_tags)
--     and story @mention tags (story_mentions) of an account with approval on
--     are stored as 'pending' and kept off its Tagged tab, Story mentions rail
--     and notifications until approved; remove = untag (row deleted).
--   • "Snooze suggested posts": while suggested_snoozed_until > NOW() the
--     Thread "for you" sources (GET /api/public/posts without ownerId,
--     GET /api/feed/for-you) return only followed accounts' posts + the
--     viewer's own.
--   • "Allow remixes of videos": who may remix the account's video posts
--     ('everyone' | 'following' = people the author follows | 'off'); a remix
--     records posts.remix_of_post_id and is refused with REMIX_NOT_ALLOWED.
-- Additive only.

ALTER TABLE user_interaction_settings
  ADD COLUMN IF NOT EXISTS manual_tag_approval BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_interaction_settings
  ADD COLUMN IF NOT EXISTS remix_audience TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE user_interaction_settings
  ADD COLUMN IF NOT EXISTS suggested_snoozed_until TIMESTAMP;

DO $$ BEGIN
  ALTER TABLE user_interaction_settings
    ADD CONSTRAINT user_interaction_settings_remix_audience_valid
    CHECK (remix_audience IN ('everyone', 'following', 'off'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 'approved' | 'pending'
ALTER TABLE post_user_tags
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE story_mentions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';

CREATE INDEX IF NOT EXISTS post_user_tags_pending_idx
  ON post_user_tags (tagged_user_id, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS story_mentions_pending_idx
  ON story_mentions (mentioned_user_id, created_at) WHERE status = 'pending';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS remix_of_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_remix_of_post_id_idx
  ON posts (remix_of_post_id) WHERE remix_of_post_id IS NOT NULL;
