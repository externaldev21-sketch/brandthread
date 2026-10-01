-- 113: Reviews v2 — seller reply moved out of the routes/reviews.ts startup
-- ALTER into a real migration, plus review photos, size/fit, and persisted
-- "Helpful" votes.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS seller_reply      TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS seller_replied_at TIMESTAMPTZ;
-- Private object-storage paths (/objects/reviews/<buyer>/<uuid>), signed on read.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS photos            JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Size is derived server-side from the purchased variant; fit is buyer-chosen.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS size_bought       TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS fit_note          TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS fit_scale         INTEGER;

CREATE TABLE IF NOT EXISTS review_helpful_votes (
  review_id  UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);
CREATE INDEX IF NOT EXISTS review_helpful_votes_user_idx ON review_helpful_votes (user_id);
