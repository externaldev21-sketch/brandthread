import { clerkClient } from "@clerk/express";
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  DELETION_POSTPONE_DAYS,
  addDays,
  getDeletionBlockers,
  purgeAccount,
} from "../lib/accountDeletion";
import { isLoginWithLiveSiblings, loginFor, markProfileDeleted, activeSiblingIds } from "../lib/accountProfiles";

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 25;
/** Back-off before retrying an account whose purge or Clerk removal failed. */
const RETRY_MS = 60 * 60 * 1000;

export interface AccountPurgeResult {
  purged: number;
  postponed: number;
  failed: number;
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number })?.status === 404;
}

/**
 * Hard-deletes accounts whose 30-day grace period has ended. Blockers are
 * re-checked first: an account that has since taken orders or holds funds is
 * postponed by a week instead of purged. Safe to retry: a purged row keeps its
 * tombstone and schedule until Clerk confirms the sign-in is gone.
 */
export async function runAccountPurge(now = new Date()): Promise<AccountPurgeResult> {
  const result: AccountPurgeResult = { purged: 0, postponed: 0, failed: 0 };
  const due = await db.select({ clerkId: users.clerkId, deletedAt: users.deletedAt })
    .from(users)
    .where(and(isNotNull(users.deletionScheduledFor), lte(users.deletionScheduledFor, now)))
    .orderBy(asc(users.deletionScheduledFor))
    .limit(BATCH_SIZE);

  for (const row of due) {
    try {
      if (!row.deletedAt) {
        const blockers = await getDeletionBlockers(row.clerkId);
        if (blockers.length > 0) {
          await db.update(users)
            .set({ deletionScheduledFor: addDays(now, DELETION_POSTPONE_DAYS), updatedAt: now })
            .where(eq(users.clerkId, row.clerkId));
          logger.warn(
            { job: "accountPurge", clerkUserId: row.clerkId, blockers: blockers.map((b) => b.code) },
            "Account deletion postponed: obligations reappeared during the grace period",
          );
          result.postponed += 1;
          continue;
        }
        await purgeAccount(row.clerkId);
      }
      await markProfileDeleted(row.clerkId, now);
      // Deleting one profile keeps the other: a login whose other profile is
      // still in use keeps its Clerk user (its password / Apple / Google).
      if (!(await isLoginWithLiveSiblings(row.clerkId))) {
        try {
          await clerkClient.users.deleteUser(row.clerkId);
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
        await releaseOrphanedLogin(row.clerkId);
      }
      await db.update(users)
        .set({ deletionScheduledFor: null, updatedAt: now })
        .where(eq(users.clerkId, row.clerkId));
      result.purged += 1;
    } catch (err) {
      result.failed += 1;
      logger.error({ err, job: "accountPurge", clerkUserId: row.clerkId }, "Account purge failed; will retry");
      await db.update(users)
        .set({ deletionScheduledFor: new Date(now.getTime() + RETRY_MS) })
        .where(eq(users.clerkId, row.clerkId))
        .catch(() => undefined);
    }
  }
  if (due.length > 0) logger.info({ job: "accountPurge", ...result }, "Account purge run finished");
  return result;
}

/**
 * After a linked profile is purged: if its login's own profile was already
 * purged and nothing else uses that login, the login itself goes too.
 */
async function releaseOrphanedLogin(profileClerkId: string): Promise<void> {
  const login = await loginFor(profileClerkId);
  if (login === profileClerkId) return;
  const [loginRow] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.clerkId, login)).limit(1);
  if (!loginRow?.deletedAt) return;
  if ((await activeSiblingIds(login)).length > 0) return;
  try {
    await clerkClient.users.getUser(login); // already removed with its own profile?
    await clerkClient.users.deleteUser(login);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

export function startAccountPurgeJob(): void {
  const run = () =>
    void runAccountPurge().catch((err) => logger.error({ err, job: "accountPurge" }, "Account purge job failed"));
  setTimeout(run, 60_000);
  setInterval(run, INTERVAL_MS).unref?.();
  logger.info({ job: "accountPurge", intervalMs: INTERVAL_MS }, "Account purge job scheduled");
}
