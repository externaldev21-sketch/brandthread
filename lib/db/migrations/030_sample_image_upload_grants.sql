-- ─── Migration 030: Sample image upload grants ───────────────────────────────
-- Server-issued, short-lived grants bind a private object path to one order and
-- one authorized user before it may be attached to an order.

CREATE TABLE IF NOT EXISTS sample_image_upload_grants (
  object_path TEXT PRIMARY KEY,
  sample_order_id UUID NOT NULL REFERENCES sample_orders(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sample_image_upload_grants_expiry_idx
  ON sample_image_upload_grants (expires_at);