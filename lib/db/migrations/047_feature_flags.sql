CREATE TABLE IF NOT EXISTS feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  description text NOT NULL DEFAULT '',
  updated_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO feature_flags (key, enabled, description)
VALUES
  ('aiPhotoShoot', true, 'AI Photo Shoot tools'),
  ('outfitSwap', true, 'Outfit Swap mode'),
  ('boosts', true, 'Paid promotion and boost tools'),
  ('manufacturerHub', true, 'Manufacturer Hub')
ON CONFLICT (key) DO NOTHING;