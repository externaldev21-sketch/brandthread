-- 099: "Tag people" on a Thread (post/reel creation, item 115).
--
-- Mirrors post_tagged_products' shape exactly (one row per tag, cascade-
-- deleted with the post) so the two features share one mental model. x/y
-- are normalized 0-1 positions on the tagged slide/frame, matching how
-- slide_overlays already places text overlays -- the draggable name chip
-- in the "Tag people" sheet writes the same coordinate space.
--
-- Both buyer and seller posts use this table (tagging people is not a
-- seller-only feature -- only product tagging is).

CREATE TABLE IF NOT EXISTS post_tagged_people (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tagged_user_id TEXT NOT NULL,
  x              DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  y              DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  slide_index    INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, tagged_user_id, slide_index)
);
CREATE INDEX IF NOT EXISTS ptpl_post_id_idx        ON post_tagged_people(post_id);
CREATE INDEX IF NOT EXISTS ptpl_tagged_user_id_idx ON post_tagged_people(tagged_user_id);
