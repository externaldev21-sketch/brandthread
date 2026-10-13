/**
 * "Founding Seller #N": the first 100 sellers on Brandthread.
 *
 * users.founding_seller_number is 1..100, unique (partial unique index + CHECK,
 * migration 271) and never reused. It is assigned once, when an account
 * completes seller onboarding (routes/auth.ts POST /onboarding/complete), in
 * the same transaction. Existing sellers were backfilled by the migration.
 *
 * Concurrency: every assignment takes one transaction-scoped advisory lock
 * (the migration's backfill takes the same one), so two sellers finishing
 * onboarding at the same moment can never get the same number or push the
 * count past 100. The unique index is the backstop.
 */
import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";

export const FOUNDING_SELLER_LIMIT = 100;
const LOCK_KEY = "founding_seller_number";

type TxRunner = Pick<typeof db, "execute">;

function rows<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

/**
 * Gives `clerkId` the next founding number if one is still free and the
 * account is eligible (a seller; not deleted, suspended, a review/system
 * account, or a test-signature email). Idempotent: an account that already
 * has a number keeps it. Must run inside a transaction (the lock is held
 * until that transaction ends). Returns the account's number, or null.
 */
export async function assignFoundingSellerNumber(tx: TxRunner, clerkId: string): Promise<number | null> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
  const [existing] = rows<{ n: number | null }>(await tx.execute(sql`
    SELECT founding_seller_number AS n FROM users WHERE clerk_id = ${clerkId} LIMIT 1
  `));
  if (!existing) return null;
  if (existing.n != null) return existing.n;

  const [assigned] = rows<{ n: number }>(await tx.execute(sql`
    UPDATE users u
    SET founding_seller_number = next.n, updated_at = now()
    FROM (SELECT COALESCE(MAX(founding_seller_number), 0) + 1 AS n FROM users) next
    WHERE u.clerk_id = ${clerkId}
      AND u.founding_seller_number IS NULL
      AND next.n <= ${FOUNDING_SELLER_LIMIT}
      AND u.account_type IN ('seller', 'both')
      AND u.deleted_at IS NULL
      AND u.deletion_requested_at IS NULL
      AND u.suspended_at IS NULL
      AND u.is_review_account = false
      AND u.is_system_account = false
      AND lower(u.email) !~ '@([a-z0-9-]+\\.)*(test|invalid|example|local|localhost)$'
    RETURNING u.founding_seller_number AS n
  `));
  return assigned?.n ?? null;
}

/** Public projection: a valid founding number, else null. */
export function publicFoundingSellerNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= FOUNDING_SELLER_LIMIT
    ? value
    : null;
}
