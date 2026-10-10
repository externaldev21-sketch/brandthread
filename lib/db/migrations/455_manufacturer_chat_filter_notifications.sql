-- 455: Manufacturer chat contact filter + manufacturer email notifications.

-- Kinds of off-platform contact / payment steering found in a message
-- (e.g. ["email","phone"]). NULL = nothing detected.
ALTER TABLE manufacturer_messages ADD COLUMN IF NOT EXISTS contact_flags JSON;

-- Throttle for "new message" emails to the manufacturer (at most one per
-- thread per 30 minutes).
ALTER TABLE manufacturer_threads ADD COLUMN IF NOT EXISTS manufacturer_emailed_at TIMESTAMPTZ;

-- One row per message that tripped the contact / payment-steering detector,
-- so admins can spot repeat offenders. The excerpt is the original text
-- (admin-only); the stored message keeps the masked text.
CREATE TABLE IF NOT EXISTS manufacturer_contact_signals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        UUID NOT NULL REFERENCES manufacturer_threads(id) ON DELETE CASCADE,
  message_id       UUID REFERENCES manufacturer_messages(id) ON DELETE SET NULL,
  manufacturer_id  UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  seller_id        TEXT NOT NULL,
  sender_clerk_id  TEXT NOT NULL,
  sender_role      TEXT NOT NULL,
  kinds            JSON NOT NULL DEFAULT '[]',
  masked           BOOLEAN NOT NULL DEFAULT FALSE,
  excerpt          TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS manufacturer_contact_signals_sender_idx
  ON manufacturer_contact_signals (sender_clerk_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manufacturer_contact_signals_created_idx
  ON manufacturer_contact_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS manufacturer_contact_signals_thread_idx
  ON manufacturer_contact_signals (thread_id);
