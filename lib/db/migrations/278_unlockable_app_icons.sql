-- 278: Unlockable app icons (Brushed silver at Insider, Chrome at Inner Circle
-- with any brand). Widens the users.app_icon_id check from migration 083 to
-- accept them; the unlock itself is checked by the API before saving.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_app_icon_id_valid;
ALTER TABLE users
  ADD CONSTRAINT users_app_icon_id_valid
  CHECK (
    app_icon_id IS NULL OR app_icon_id IN (
      'monochrome', 'purple', 'olive', 'navy', 'champagne', 'black',
      'silver', 'black-gold', 'emerald-gold', 'leopard-red', 'maroon', 'gold',
      'brushed-silver', 'chrome'
    )
  );
