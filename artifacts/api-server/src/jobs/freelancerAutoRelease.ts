/**
 * Freelancer job auto-release (BT-446).
 *
 * Every 15 minutes:
 *  1. Reminds the hirer once, ~1 day before an untouched delivery is approved
 *     automatically.
 *  2. Approves deliveries whose auto_release_at has passed and sends the
 *     freelancer's payout (lib/freelancerRelease.ts — same exactly-once path
 *     as a hirer approval). Disputed jobs are never touched.
 *  3. Retries payouts left unsent by a crash (status 'completed', no transfer
 *     id, completed more than 10 minutes ago).
 *
 * Multi-instance safe: the run holds a session-level pg_try_advisory_lock,
 * so only one server does the sweep; every step is idempotent anyway.
 * Skipped entirely when Stripe isn't configured.
 */
import { and, eq, gt, isNull, lt, lte } from "drizzle-orm";
import { db, freelancers, freelancerJobs, pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { stripe as stripeClient } from "../lib/stripe";
import {
  AUTO_RELEASE_REMINDER_LEAD_MS,
  displayName,
  formatUsd,
  notifyJob,
  releaseJobPayout,
} from "../lib/freelancerRelease";

const INTERVAL_MS = 15 * 60 * 1000;
const STUCK_PAYOUT_GRACE_MS = 10 * 60 * 1000;
const BATCH = 50;
/** Arbitrary constant key for pg_try_advisory_lock (hashtext of the job name). */
const LOCK_NAME = "freelancer-auto-release";

export type AutoReleaseSummary = {
  reminded: number;
  released: number;
  retried: number;
  failed: number;
  skipped?: "locked" | "no_stripe";
};

let running = false;

export async function runFreelancerAutoRelease(
  now = new Date(),
  opts: { stripe?: any } = {},
): Promise<AutoReleaseSummary> {
  const summary: AutoReleaseSummary = { reminded: 0, released: 0, retried: 0, failed: 0 };
  const stripe = opts.stripe ?? stripeClient;
  if (!stripe) return { ...summary, skipped: "no_stripe" };

  const client = await pool.connect();
  let locked = false;
  try {
    const r = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [LOCK_NAME],
    );
    locked = r.rows[0]?.locked === true;
    if (!locked) return { ...summary, skipped: "locked" };

    // 1) Reminders — claimed with a conditional UPDATE so each delivery is
    //    reminded at most once even if two sweeps overlap.
    const due = await db
      .update(freelancerJobs)
      .set({ autoReleaseRemindedAt: now })
      .where(
        and(
          eq(freelancerJobs.status, "delivered"),
          isNull(freelancerJobs.autoReleaseRemindedAt),
          gt(freelancerJobs.autoReleaseAt, now),
          lte(freelancerJobs.autoReleaseAt, new Date(now.getTime() + AUTO_RELEASE_REMINDER_LEAD_MS)),
        ),
      )
      .returning({ id: freelancerJobs.id, sellerId: freelancerJobs.sellerId, title: freelancerJobs.title });
    for (const job of due) {
      notifyJob(
        job.sellerId,
        job.id,
        "freelancer_job_auto_release_reminder",
        "Review the delivery",
        `"${job.title}" is marked complete and paid out in 1 day. Approve it, request a revision, or report a problem before then.`,
      );
      summary.reminded++;
    }

    // 2) Auto-approve untouched deliveries.
    const releasable = await db
      .select({ id: freelancerJobs.id })
      .from(freelancerJobs)
      .where(and(eq(freelancerJobs.status, "delivered"), lte(freelancerJobs.autoReleaseAt, now)))
      .limit(BATCH);
    for (const { id } of releasable) {
      try {
        const result = await releaseJobPayout(stripe, id, { trigger: "auto" });
        if (result.claimedNow) {
          summary.released++;
          const [row] = await db
            .select({ sellerId: freelancerJobs.sellerId, title: freelancerJobs.title, freelancerUserId: freelancers.userId })
            .from(freelancerJobs)
            .innerJoin(freelancers, eq(freelancers.id, freelancerJobs.freelancerId))
            .where(eq(freelancerJobs.id, id))
            .limit(1);
          if (row) {
            notifyJob(
              row.freelancerUserId,
              id,
              "freelancer_job_approved",
              "Payment released",
              `"${row.title}" was marked complete. ${formatUsd(result.amountCents)} is on its way to your bank account.`,
              "payouts",
            );
            const freelancerName = await displayName(row.freelancerUserId, "the freelancer");
            notifyJob(
              row.sellerId,
              id,
              "freelancer_job_auto_completed",
              "Job complete",
              `"${row.title}" was marked complete and ${freelancerName} was paid.`,
            );
          }
        }
      } catch (err) {
        summary.failed++;
        logger.warn({ err, jobId: id, job: "freelancerAutoRelease" }, "Freelancer auto-release failed; will retry");
      }
    }

    // 3) Retry payouts a crash left unsent.
    const stuck = await db
      .select({ id: freelancerJobs.id })
      .from(freelancerJobs)
      .where(
        and(
          eq(freelancerJobs.status, "completed"),
          eq(freelancerJobs.paymentStatus, "paid"),
          isNull(freelancerJobs.stripeTransferId),
          gt(freelancerJobs.freelancerPayoutCents, 0),
          lt(freelancerJobs.completedAt, new Date(now.getTime() - STUCK_PAYOUT_GRACE_MS)),
        ),
      )
      .limit(BATCH);
    for (const { id } of stuck) {
      try {
        const result = await releaseJobPayout(stripe, id, { trigger: "auto" });
        if (result.transferId) summary.retried++;
      } catch (err) {
        summary.failed++;
        logger.warn({ err, jobId: id, job: "freelancerAutoRelease" }, "Freelancer payout retry failed");
      }
    }
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_NAME]).catch(() => {});
    }
    client.release();
  }
  return summary;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runFreelancerAutoRelease();
    if (result.reminded || result.released || result.retried || result.failed) {
      logger.info({ job: "freelancerAutoRelease", ...result }, "Freelancer auto-release run made progress");
    }
  } catch (err) {
    logger.error({ err, job: "freelancerAutoRelease" }, "Freelancer auto-release run failed");
  } finally {
    running = false;
  }
}

export function startFreelancerAutoReleaseJob(): void {
  setTimeout(() => void tick(), 3 * 60 * 1000).unref?.();
  setInterval(() => void tick(), INTERVAL_MS).unref?.();
  logger.info({ job: "freelancerAutoRelease", intervalMs: INTERVAL_MS }, "Freelancer auto-release job scheduled");
}

// Exported for tests: lets a test hold the lock to prove the sweep skips.
export const FREELANCER_AUTO_RELEASE_LOCK = LOCK_NAME;
