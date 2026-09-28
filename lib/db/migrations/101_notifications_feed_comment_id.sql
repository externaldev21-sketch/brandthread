-- 101: Activity item 82 — tap a comment / reply / mention notification to
-- land on that exact comment.
--
-- Comment notifications already point at the post (target_id); this adds the
-- specific comment. Additive and nullable: every existing row keeps working
-- (it just opens the post's comments without a highlighted comment), and
-- nothing else reads or writes the column.

ALTER TABLE notifications_feed
  ADD COLUMN IF NOT EXISTS comment_id TEXT;
