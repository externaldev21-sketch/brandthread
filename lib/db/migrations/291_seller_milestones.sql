-- 291: seller milestones (first sale, $1K / $10K / $100K in sales, 100 and
-- 1,000 orders). One row per seller per milestone, written lazily by
-- GET /api/seller/milestones/next with ON CONFLICT DO NOTHING. seen_at is set
-- when the seller shares or closes the dashboard card (or when a higher
-- milestone reached at the same time supersedes it), so a card shows once.
-- product_id is the product whose photo the card shows.
CREATE TABLE IF NOT EXISTS seller_milestones (
  owner_id   TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  reached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at    TIMESTAMPTZ,
  product_id UUID,
  PRIMARY KEY (owner_id, key)
);
