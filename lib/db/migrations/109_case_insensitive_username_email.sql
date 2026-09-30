-- ─── Migration 109: Case-insensitive username + email uniqueness ─────────────
-- Multi-account support (up to 8 signed-in accounts/device) needs a hard
-- guarantee that 'GalleryDesires' and 'gallerydesires' can never both exist,
-- and that every account (buyer or seller) has its own email. Both
-- guarantees must live at the DB level — app-level pre-check-then-write is
-- a race (two signups completing the same username/email concurrently).
--
-- Safety: this migration NEVER deletes or renames any row. It first RAISEs
-- a NOTICE listing any pre-existing case-insensitive duplicates (so an
-- operator can see and manually resolve them), then normalizes every
-- existing non-null value to lowercase (same value, just cased — not a
-- rename), then creates the case-insensitive partial unique indexes. If
-- real duplicate rows still exist after normalization, index creation
-- fails loudly (Postgres itself refuses a duplicate-violating unique
-- index) rather than silently applying a broken constraint or picking a
-- winner — that failure is the intended signal for manual resolution.

-- ── Report (non-blocking) ──────────────────────────────────────────────────
DO $$
DECLARE
  dup RECORD;
  dup_count INT := 0;
BEGIN
  FOR dup IN
    SELECT lower(username) AS uname, array_agg(id) AS ids, array_agg(username) AS originals
    FROM users
    WHERE username IS NOT NULL
    GROUP BY lower(username)
    HAVING count(*) > 1
  LOOP
    dup_count := dup_count + 1;
    RAISE NOTICE 'Duplicate username (case-insensitive) "%": user ids % (original values %)',
      dup.uname, dup.ids, dup.originals;
  END LOOP;
  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % case-insensitive username duplicate group(s) — resolve manually before this migration can finish (unique index creation below will fail until then).', dup_count;
  ELSE
    RAISE NOTICE 'No case-insensitive username duplicates found.';
  END IF;

  dup_count := 0;
  FOR dup IN
    SELECT lower(email) AS addr, array_agg(id) AS ids, array_agg(email) AS originals
    FROM users
    GROUP BY lower(email)
    HAVING count(*) > 1
  LOOP
    dup_count := dup_count + 1;
    RAISE NOTICE 'Duplicate email (case-insensitive) "%": user ids % (original values %)',
      dup.addr, dup.ids, dup.originals;
  END LOOP;
  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % case-insensitive email duplicate group(s) — resolve manually before this migration can finish (unique index creation below will fail until then).', dup_count;
  ELSE
    RAISE NOTICE 'No case-insensitive email duplicates found.';
  END IF;
END $$;

-- ── Normalize casing (same value, not a rename) ────────────────────────────
UPDATE users SET username = lower(username) WHERE username IS NOT NULL AND username <> lower(username);
UPDATE users SET email = lower(email) WHERE email <> lower(email);

-- ── Case-insensitive uniqueness (fails loudly if real dupes remain) ───────
DROP INDEX IF EXISTS users_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci_unique
  ON users (lower(username))
  WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci_unique
  ON users (lower(email));
