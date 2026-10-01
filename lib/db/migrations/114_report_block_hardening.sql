-- 114: Report + Block hardening.
-- blocks already has PRIMARY KEY (blocker_id, blocked_id); "who blocked me" lookups
-- (two-way visibility checks) need an index on blocked_id.
CREATE INDEX IF NOT EXISTS blocks_blocked_id_idx ON blocks (blocked_id);
-- Re-report cooldown lookups (same reporter + target, recently resolved).
CREATE INDEX IF NOT EXISTS reports_reporter_target_resolved_idx
  ON reports (reporter_id, target_type, target_id, resolved_at);
