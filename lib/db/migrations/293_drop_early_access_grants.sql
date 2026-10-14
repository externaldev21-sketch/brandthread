-- 293: Superfans early access — per-buyer early access grants for one drop.
--
-- A seller taps "Give early access" on the Customers > Superfans tab and every
-- superfan (top 1% of signed-in buyers by spend) gets a row here for the
-- seller's next drop. checkoutPlan.ts lets a granted buyer check out during
-- the drop's early window (early_access_minutes, or 60 when that is 0),
-- even if they don't follow the seller. Idempotent; touches no existing data.

CREATE TABLE IF NOT EXISTS drop_early_access_grants (
  drop_id    uuid        NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  buyer_id   text        NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text        NOT NULL,
  PRIMARY KEY (drop_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS drop_early_access_grants_buyer_idx
  ON drop_early_access_grants (buyer_id);
