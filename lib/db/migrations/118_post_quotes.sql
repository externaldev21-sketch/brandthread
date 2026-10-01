-- 118: Quote repost. A quote is a normal post that embeds one direct original.
-- ON DELETE SET NULL (never cascade): deleting an original must not delete the
-- quotes of it; readers show "unavailable" for repost_kind = 'quote' rows whose
-- quoted_post_id is NULL or no longer publicly visible.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS quoted_post_id UUID;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS repost_kind TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_quoted_post_id_fkey') THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_quoted_post_id_fkey
      FOREIGN KEY (quoted_post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS posts_quoted_post_idx ON posts (quoted_post_id) WHERE quoted_post_id IS NOT NULL;
