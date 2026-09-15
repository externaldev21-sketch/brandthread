ALTER TABLE design_studio_assets
  ADD COLUMN IF NOT EXISTS upload_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS design_studio_assets_upload_id_unique
  ON design_studio_assets(owner_id, project_id, upload_id)
  WHERE upload_id IS NOT NULL;