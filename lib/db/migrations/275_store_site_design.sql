-- 275: Store website (brandthread.app/@handle) design choices on the existing
-- link-in-bio page row. The logo and banner images themselves are the seller's
-- store identity images (users.logo_url / users.banner_url); show_banner lets
-- the site leave the banner out.
ALTER TABLE bio_pages ADD COLUMN IF NOT EXISTS show_banner BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bio_pages ADD COLUMN IF NOT EXISTS button_style TEXT NOT NULL DEFAULT 'rounded';
ALTER TABLE bio_pages ADD COLUMN IF NOT EXISTS font TEXT NOT NULL DEFAULT 'system';
