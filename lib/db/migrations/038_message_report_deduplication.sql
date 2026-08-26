-- Keep duplicate reports from the same user out of both fresh schema-push
-- databases and migrated databases. A unique index is safe to add repeatedly.
CREATE UNIQUE INDEX IF NOT EXISTS message_reports_message_reporter_unique
  ON message_reports(message_id, reporter_id);