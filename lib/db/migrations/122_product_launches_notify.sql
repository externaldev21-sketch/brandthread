-- Pre-order ship-by terms, scheduled product launches and launch notify-me.
CREATE TABLE IF NOT EXISTS product_preorder_terms (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  ship_by_date timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_launches (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  launch_at timestamptz NOT NULL,
  notify_followers boolean NOT NULL DEFAULT false,
  launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_launches_due_idx ON product_launches (launched_at, launch_at);

CREATE TABLE IF NOT EXISTS product_launch_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_launch_alerts_product_user_unique UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS product_launch_alerts_user_idx ON product_launch_alerts (user_id);
