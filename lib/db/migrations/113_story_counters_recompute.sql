-- 113: Story like/view counters drifted (select-then-update races). Recompute
-- from the source-of-truth rows. Idempotent: re-running yields the same values.
UPDATE stories s
   SET likes_count = COALESCE((SELECT COUNT(*) FROM story_likes l WHERE l.story_id = s.id), 0)
 WHERE s.likes_count IS DISTINCT FROM COALESCE((SELECT COUNT(*) FROM story_likes l WHERE l.story_id = s.id), 0);

UPDATE stories s
   SET views_count = COALESCE((SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id), 0)
 WHERE s.views_count IS DISTINCT FROM COALESCE((SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id), 0);
