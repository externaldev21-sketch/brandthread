-- ─── Migration 020: Team ↔ Clerk linking + structured audit log ──────────────
-- Adds member_clerk_id so accepted invitees are bound to their Clerk account
-- (required for API role enforcement), and structured actor/resource columns
-- on team_activity_logs so key seller mutations (products, orders, inventory)
-- can be attributed to the team member who performed them and filtered.

ALTER TABLE team_members ADD COLUMN IF NOT EXISTS member_clerk_id TEXT;
CREATE INDEX IF NOT EXISTS team_members_member_clerk_idx ON team_members(member_clerk_id);
CREATE INDEX IF NOT EXISTS team_members_owner_idx        ON team_members(owner_id);

ALTER TABLE team_activity_logs ADD COLUMN IF NOT EXISTS actor_clerk_id TEXT;
ALTER TABLE team_activity_logs ADD COLUMN IF NOT EXISTS actor_role     TEXT;
ALTER TABLE team_activity_logs ADD COLUMN IF NOT EXISTS resource_type  TEXT;
ALTER TABLE team_activity_logs ADD COLUMN IF NOT EXISTS resource_id    TEXT;
CREATE INDEX IF NOT EXISTS team_activity_owner_created_idx
  ON team_activity_logs(owner_id, created_at DESC);
