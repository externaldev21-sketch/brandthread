-- Reusable size chart templates. Applying a template copies its chart into
-- products.size_chart (buyers keep reading that column); the link rows below
-- let a seller re-sync products after editing a template.
CREATE TABLE IF NOT EXISTS size_chart_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  chart       JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS size_chart_templates_owner_name_uidx
  ON size_chart_templates (owner_id, lower(name));

CREATE TABLE IF NOT EXISTS product_size_chart_links (
  product_id   UUID        PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  template_id  UUID        NOT NULL REFERENCES size_chart_templates(id) ON DELETE CASCADE,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_size_chart_links_template_idx
  ON product_size_chart_links (template_id);
