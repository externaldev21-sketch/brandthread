-- Apply owner-safe relational integrity to databases that ran earlier drafts.
CREATE UNIQUE INDEX IF NOT EXISTS design_studio_projects_id_owner_unique
  ON design_studio_projects(id, owner_id);
ALTER TABLE design_studio_assets
  DROP CONSTRAINT IF EXISTS design_studio_assets_project_owner_fk;
ALTER TABLE design_studio_assets
  ADD CONSTRAINT design_studio_assets_project_owner_fk
  FOREIGN KEY (project_id, owner_id)
  REFERENCES design_studio_projects(id, owner_id) ON DELETE CASCADE;