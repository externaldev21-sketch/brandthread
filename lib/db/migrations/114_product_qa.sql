-- 114: Product Q&A — public questions from signed-in buyers, answered by the
-- seller that owns the product.
CREATE TABLE IF NOT EXISTS product_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  seller_id  TEXT NOT NULL,
  asker_id   TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS product_questions_product_idx ON product_questions (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_questions_seller_idx  ON product_questions (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_questions_asker_idx   ON product_questions (asker_id, created_at DESC);

CREATE TABLE IF NOT EXISTS product_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES product_questions(id) ON DELETE CASCADE,
  seller_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_answers_question_unique ON product_answers (question_id);
