-- Scheduled-post publisher: the job scans `post_status = 'scheduled' AND scheduled_at <= now()`
-- every minute. A partial index keeps that scan tiny no matter how many published posts exist.
-- Idempotent.
CREATE INDEX IF NOT EXISTS posts_scheduled_due_idx
  ON posts (scheduled_at)
  WHERE post_status = 'scheduled';

-- Drafts are listed per owner (GET /api/posts/mine?status=draft) and counted for the draft cap.
CREATE INDEX IF NOT EXISTS posts_user_draft_idx
  ON posts (user_id, updated_at DESC)
  WHERE post_status = 'draft';
