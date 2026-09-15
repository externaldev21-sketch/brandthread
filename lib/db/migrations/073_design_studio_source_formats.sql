ALTER TABLE design_studio_assets
  DROP CONSTRAINT IF EXISTS design_studio_assets_mime_type_check;
ALTER TABLE design_studio_assets
  DROP CONSTRAINT IF EXISTS design_studio_assets_format_check;
ALTER TABLE design_studio_assets
  ADD CONSTRAINT design_studio_assets_mime_type_check
  CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp'));
ALTER TABLE design_studio_assets
  ADD CONSTRAINT design_studio_assets_format_check
  CHECK (format IN ('png', 'jpeg', 'gif', 'webp'));