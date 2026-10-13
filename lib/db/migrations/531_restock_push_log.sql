-- 531: Restock push dedupe/cooldown log (bag restock + "Your size is back").
-- One row per (buyer, variant, kind). The fan-out claims a row atomically with
-- INSERT ... ON CONFLICT DO UPDATE SET sent_at = now() WHERE sent_at is older
-- than the 7-day cooldown, RETURNING the winners.
CREATE TABLE IF NOT EXISTS restock_push_log (
  user_id    TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS restock_push_log_user_variant_kind_uq
  ON restock_push_log (user_id, variant_id, kind);
