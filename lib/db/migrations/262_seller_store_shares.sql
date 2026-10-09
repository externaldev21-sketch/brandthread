-- 262: When a seller first shared their store link (Copy / Share / Save QR).
-- Drives the "Share your store" step of the dashboard's Get ready to sell list.
CREATE TABLE IF NOT EXISTS seller_store_shares (
  seller_id        TEXT PRIMARY KEY,
  first_shared_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_shared_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  share_count      INTEGER NOT NULL DEFAULT 1
);
