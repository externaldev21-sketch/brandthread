-- 241: Prepaid return labels and refund-on-scan.
-- A return label is a shipping_labels row with direction = 'return' (so its
-- cost goes through the same ledger entries as an outbound label) and is
-- exempt from the "one open label per order" rule. The returns row remembers
-- the label, the buyer's return tracking, and whether the refund waits for the
-- carrier's first scan.
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound';
ALTER TABLE shipping_labels ADD COLUMN IF NOT EXISTS return_id TEXT;
CREATE INDEX IF NOT EXISTS shipping_labels_return_idx ON shipping_labels(return_id) WHERE return_id IS NOT NULL;

-- Rebuild the open-label rule so it covers outbound whole-order labels only.
-- Built from whichever optional columns exist (item_ids arrives with the
-- partial-shipment migration), so the order of migrations does not matter.
DO $$
DECLARE cond text := 'status IN (''purchasing'', ''active'', ''void_pending'') AND direction = ''outbound''';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shipping_labels' AND column_name = 'item_ids') THEN
    cond := cond || ' AND item_ids IS NULL';
  END IF;
  EXECUTE 'DROP INDEX IF EXISTS shipping_labels_one_open_per_order';
  EXECUTE 'CREATE UNIQUE INDEX shipping_labels_one_open_per_order ON shipping_labels(order_id) WHERE ' || cond;
END $$;

ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_label_id UUID;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_label_url TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_carrier TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_tracking_number TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_tracking_status TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_on_scan BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS first_scan_at TIMESTAMP;
