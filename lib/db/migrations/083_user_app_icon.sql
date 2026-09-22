ALTER TABLE users
  ADD COLUMN IF NOT EXISTS app_icon_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_app_icon_id_valid'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_app_icon_id_valid
      CHECK (
        app_icon_id IS NULL OR app_icon_id IN (
          'monochrome', 'purple', 'olive', 'navy', 'champagne', 'black',
          'silver', 'black-gold', 'emerald-gold', 'leopard-red', 'maroon', 'gold'
        )
      );
  END IF;
END
$$;