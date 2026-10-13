-- 300 (F6): product mentions in captions + post labels ("Behind the scenes").

CREATE TABLE IF NOT EXISTS post_product_mentions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ppm_post_id_idx ON post_product_mentions (post_id, position);
CREATE INDEX IF NOT EXISTS ppm_product_id_idx ON post_product_mentions (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS ppm_post_product_unique ON post_product_mentions (post_id, product_id);

CREATE TABLE IF NOT EXISTS post_labels (
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  label      TEXT NOT NULL CHECK (label IN ('bts')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, label)
);
CREATE INDEX IF NOT EXISTS post_labels_label_idx ON post_labels (label, created_at);
