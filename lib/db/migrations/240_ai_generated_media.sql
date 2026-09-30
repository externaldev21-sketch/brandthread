-- 240: Provenance registry for AI-generated media.
-- The AI safety guard (api-server src/middlewares/aiSafetyGuard.ts) records the
-- SHA-256 of every generated image it returns, so saved assets and posts can be
-- checked against it and labelled ai_generated without changing their tables.
CREATE TABLE IF NOT EXISTS ai_generated_media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   TEXT NOT NULL,
  tool       TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_generated_media_owner_sha_uniq ON ai_generated_media (owner_id, sha256);
CREATE INDEX IF NOT EXISTS ai_generated_media_sha_idx ON ai_generated_media (sha256);
