-- 117: Account security — @handle change cooldown + async "Download my data" jobs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS data_export_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued',  -- queued | running | ready | failed | expired
  categories          JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_object_key     TEXT,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  ready_at            TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  download_token_hash TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  emailed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS data_export_jobs_clerk_idx ON data_export_jobs (clerk_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS data_export_jobs_status_idx ON data_export_jobs (status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS data_export_jobs_token_hash_uniq ON data_export_jobs (download_token_hash) WHERE download_token_hash IS NOT NULL;
