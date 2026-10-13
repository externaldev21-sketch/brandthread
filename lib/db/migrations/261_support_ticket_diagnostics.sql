-- 261: Device/app details attached to support tickets from "Report a problem".
-- support_tickets is created by artifacts/api-server/src/routes/support.ts;
-- the CREATE below matches it so this migration also works on a fresh DB.
CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id    TEXT    NOT NULL,
  email       TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'general',
  status      TEXT    NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS diagnostics JSONB;
