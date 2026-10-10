import { db, users } from "@workspace/db";
import { and, ne, sql } from "drizzle-orm";
import { isUniqueViolation, violatedConstraint } from "./dbErrors";

/**
 * A local `users` row keeps its email after its Clerk user is deleted (from
 * the Clerk dashboard, a test cleanup or an instance reset: there is no
 * `user.deleted` webhook) or after that person changes their email in Clerk.
 * Clerk itself only lets one user hold a verified email, so when a brand-new
 * Clerk user has verified an email that a local row still carries, that row's
 * claim is stale. Without this check the new person is told "An account with
 * this email already exists" for an email no live account uses.
 */

type ClerkEmailOwner = {
  emailAddresses?: readonly { emailAddress?: string | null }[];
};

export type GetClerkUser = (clerkId: string) => Promise<ClerkEmailOwner>;

export type EmailClaimDecision = "stale" | "live" | "unknown";

function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; errors?: { code?: string }[] } | null;
  if (e?.status === 404 || e?.statusCode === 404) return true;
  return e?.errors?.some((item) => item?.code === "resource_not_found") ?? false;
}

/**
 * Whether the Clerk user behind an existing local row still owns `email`.
 * Any lookup failure other than "not found" is "unknown" so a Clerk outage
 * can never release a real person's email.
 */
export async function classifyEmailClaim(
  holderClerkId: string,
  email: string,
  getClerkUser: GetClerkUser,
): Promise<EmailClaimDecision> {
  const target = email.trim().toLowerCase();
  try {
    const holder = await getClerkUser(holderClerkId);
    const owns = (holder.emailAddresses ?? []).some(
      (address) => (address.emailAddress ?? "").trim().toLowerCase() === target,
    );
    return owns ? "live" : "stale";
  } catch (err) {
    return isNotFound(err) ? "stale" : "unknown";
  }
}

/**
 * Placeholder that keeps the row (and all its data) while freeing the email.
 * Same production domain as account deletion's tombstones so the test-data
 * purge tooling (lib/db/src/testing/signatures.ts) never mistakes it for a
 * test row.
 */
export function releasedEmailFor(rowId: string): string {
  return `deleted+released-${rowId}@deleted.brandthread.invalid`;
}

/**
 * Frees `email` from local rows (other than `requesterClerkId`) whose Clerk
 * user no longer owns it. Returns true when at least one row was released and
 * no live owner remains, i.e. the caller may retry its write.
 */
export async function releaseStaleEmailClaims(
  email: string,
  requesterClerkId: string,
  getClerkUser: GetClerkUser,
): Promise<boolean> {
  const target = email.trim().toLowerCase();
  if (!target) return false;
  const holders = await db
    .select({ id: users.id, clerkId: users.clerkId })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${target}`, ne(users.clerkId, requesterClerkId)));
  if (holders.length === 0) return false;

  const stale: string[] = [];
  for (const holder of holders) {
    const decision = await classifyEmailClaim(holder.clerkId, target, getClerkUser);
    if (decision !== "stale") return false;
    stale.push(holder.id);
  }
  for (const id of stale) {
    await db
      .update(users)
      .set({ email: releasedEmailFor(id), updatedAt: new Date() })
      .where(sql`${users.id} = ${id} AND lower(${users.email}) = ${target}`);
  }
  return true;
}


/** Either email index: the exact `users_email_unique` or the lower(email) one (migration 109). */
export function isEmailUniqueViolation(err: unknown): boolean {
  if (!isUniqueViolation(err)) return false;
  const constraint = violatedConstraint(err);
  return constraint === "users_email_unique" || constraint === "users_email_ci_unique";
}
