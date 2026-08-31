-- Persist every field exposed by the seller post editor.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS media_urls JSON NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  ADD COLUMN IF NOT EXISTS hashtags JSON NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS sound JSON,
  ADD COLUMN IF NOT EXISTS visibility JSON NOT NULL DEFAULT
    '{"isPublic":true,"allowComments":true,"allowReposts":true,"showLikeCount":true}';

-- Preserve legacy single-media posts in the richer media collection.
UPDATE posts
SET media_urls = json_build_array(media_url)
WHERE json_array_length(media_urls) = 0 AND media_url <> '';