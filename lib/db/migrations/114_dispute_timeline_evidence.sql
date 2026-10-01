-- 114: Dispute status timeline + uploaded evidence files.
-- The existing `disputes` table is untouched apart from one nullable column
-- that records the moment evidence was sent to Stripe for review (Stripe allows
-- exactly one submission per dispute).
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence_submitted_at TIMESTAMP;

-- One row per thing that happened to a dispute. stripe_event_id is unique so a
-- replayed webhook can never write the same timeline entry twice; events that
-- originate in our own API use a deterministic synthetic id ("local-submit/<id>").
CREATE TABLE IF NOT EXISTS dispute_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  stripe_event_id TEXT NOT NULL,
  -- created | evidence_due_soon | updated | funds_withdrawn | funds_reinstated
  -- | evidence_submitted | accepted | won | lost | warning_closed
  kind            TEXT NOT NULL,
  -- Safe summary only (status, amounts, fee) — never the raw Stripe payload.
  payload         JSONB NOT NULL DEFAULT '{}',
  occurred_at     TIMESTAMP NOT NULL DEFAULT now(),
  -- Set when the seller notification for this event was handed off.
  notified_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dispute_events_stripe_event_unique ON dispute_events (stripe_event_id);
CREATE INDEX IF NOT EXISTS dispute_events_dispute_idx ON dispute_events (dispute_id, occurred_at);

-- Files the seller uploaded as evidence. evidence_type is the Stripe evidence
-- field the file is sent under (receipt, shipping_documentation, ...), so there
-- is at most one live file per type per dispute.
CREATE TABLE IF NOT EXISTS dispute_evidence_files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id     UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  seller_id      TEXT NOT NULL,
  evidence_type  TEXT NOT NULL,
  file_name      TEXT NOT NULL DEFAULT '',
  object_key     TEXT NOT NULL,
  content_type   TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  stripe_file_id TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispute_evidence_files_dispute_idx ON dispute_evidence_files (dispute_id);
CREATE UNIQUE INDEX IF NOT EXISTS dispute_evidence_files_type_unique ON dispute_evidence_files (dispute_id, evidence_type);
