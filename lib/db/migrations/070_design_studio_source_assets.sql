-- Existing development databases may already have applied migration 069.
ALTER TABLE design_studio_assets DROP CONSTRAINT IF EXISTS design_studio_assets_kind_check;
ALTER TABLE design_studio_assets DROP CONSTRAINT IF EXISTS design_studio_assets_check;
ALTER TABLE design_studio_assets
  ADD CONSTRAINT design_studio_assets_kind_check
  CHECK (kind IN ('master', 'thumbnail', 'source'));
ALTER TABLE design_studio_assets
  ADD CONSTRAINT design_studio_assets_master_quality_check
  CHECK (
    kind <> 'master'
    OR (format = 'png' AND mime_type = 'image/png' AND lossless = TRUE AND quality IS NULL)
    OR (format = 'jpeg' AND mime_type = 'image/jpeg' AND lossless = FALSE AND quality BETWEEN 95 AND 100)
  );
CREATE UNIQUE INDEX IF NOT EXISTS design_studio_projects_id_owner_unique
  ON design_studio_projects(id, owner_id);
ALTER TABLE design_studio_assets
  DROP CONSTRAINT IF EXISTS design_studio_assets_project_owner_fk;
ALTER TABLE design_studio_assets
  ADD CONSTRAINT design_studio_assets_project_owner_fk
  FOREIGN KEY (project_id, owner_id)
  REFERENCES design_studio_projects(id, owner_id) ON DELETE CASCADE;