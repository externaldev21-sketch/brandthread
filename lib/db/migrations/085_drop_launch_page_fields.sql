-- Cinematic drop launch pages: hero media, display timezone, follower early access.
ALTER TABLE drops ADD COLUMN IF NOT EXISTS hero_image_url TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS hero_video_url TEXT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS launch_timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE drops ADD COLUMN IF NOT EXISTS early_access_minutes INTEGER NOT NULL DEFAULT 0;
