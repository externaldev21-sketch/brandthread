-- 116: Opt-in "let friends find me" contact hashes (contact sync).
-- A row exists ONLY when the user explicitly opts in. `hash` is a SHA-256 hex
-- digest of the user's OWN normalized email (derived server-side from their
-- account) or phone (hashed on device). Raw address-book contacts are never
-- stored; the match endpoint only reads this table. Erased with the account
-- (routes/auth.ts) and on DELETE /api/social/contacts.
CREATE TABLE IF NOT EXISTS user_contact_hashes (
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('email', 'phone')),
  hash       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind, hash)
);
CREATE INDEX IF NOT EXISTS user_contact_hashes_lookup_idx ON user_contact_hashes (kind, hash);
