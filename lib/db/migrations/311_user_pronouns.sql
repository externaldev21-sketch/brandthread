-- 311: Optional pronouns on the profile (Instagram edit profile → Pronouns),
-- shown next to the name. Previously kept only on the device.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pronouns VARCHAR(40);
