-- Keep composed video thumbnails stable after signed editor previews expire.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;