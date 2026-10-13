-- Keep the richer, owner-locked post_pins implementation. This migration also
-- handles databases where the original 301 migration has already been applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'posts' AND column_name = 'pinned_at'
  ) THEN
    INSERT INTO post_pins (post_id, user_id, pinned_at)
      SELECT id, user_id, pinned_at FROM posts WHERE pinned_at IS NOT NULL
    ON CONFLICT (post_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          pinned_at = GREATEST(post_pins.pinned_at, EXCLUDED.pinned_at);
  END IF;
END $$;

-- Reconcile overlapping sets using the same three-most-recent published pins
-- rule as the application. Inactive pins do not count toward the live cap.
WITH ranked AS (
  SELECT pp.post_id,
         row_number() OVER (PARTITION BY pp.user_id ORDER BY pp.pinned_at DESC, pp.post_id ASC) AS position
  FROM post_pins pp JOIN posts p ON p.id = pp.post_id
  WHERE p.post_status = 'published'
)
DELETE FROM post_pins WHERE post_id IN (SELECT post_id FROM ranked WHERE position > 3);

DROP INDEX IF EXISTS posts_user_pinned_idx;
ALTER TABLE posts DROP COLUMN IF EXISTS pinned_at;
