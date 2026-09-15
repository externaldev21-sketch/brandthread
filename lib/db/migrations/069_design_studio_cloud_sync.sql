-- Editable Design Studio state and binary assets are deliberately separate.
CREATE TABLE IF NOT EXISTS design_studio_projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  snapshot    JSONB NOT NULL DEFAULT '{}',
  revision    INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS design_studio_projects_owner_id_idx
  ON design_studio_projects(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS design_studio_projects_id_owner_unique
  ON design_studio_projects(id, owner_id);

CREATE TABLE IF NOT EXISTS design_studio_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  TEXT NOT NULL REFERENCES design_studio_projects(id) ON DELETE CASCADE,
  owner_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('master', 'thumbnail', 'source')),
  object_path TEXT NOT NULL,
  width       INTEGER NOT NULL CHECK (width > 0),
  height      INTEGER NOT NULL CHECK (height > 0),
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  format      TEXT NOT NULL CHECK (format IN ('png', 'jpeg', 'gif', 'webp')),
  lossless    BOOLEAN NOT NULL,
  quality     INTEGER CHECK (quality IS NULL OR quality BETWEEN 95 AND 100),
  byte_size   INTEGER NOT NULL CHECK (byte_size > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT design_studio_assets_project_owner_fk
    FOREIGN KEY (project_id, owner_id)
    REFERENCES design_studio_projects(id, owner_id) ON DELETE CASCADE,
  CHECK (
    kind <> 'master'
    OR (format = 'png' AND mime_type = 'image/png' AND lossless = TRUE AND quality IS NULL)
    OR (format = 'jpeg' AND mime_type = 'image/jpeg' AND lossless = FALSE AND quality BETWEEN 95 AND 100)
  )
);
CREATE INDEX IF NOT EXISTS design_studio_assets_project_id_idx
  ON design_studio_assets(project_id);
CREATE INDEX IF NOT EXISTS design_studio_assets_owner_id_idx
  ON design_studio_assets(owner_id);