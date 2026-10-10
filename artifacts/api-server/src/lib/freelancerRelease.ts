/**
 * Freelancer job payout release (BT-446).
 *
 * The ONLY code path that moves escrow money to a freelancer. It is called by
 *  - the hirer approving a delivery (PATCH /freelancer-jobs/:id/approve),
 *  - the auto-release job, FREELANCER_AUTO_RELEASE_DAYS after an untouched
 *    delivery (jobs/freelancerAutoRelease.ts),
 *  - an admin resolving a dispute in the freelancer's favour (admin PR; pass
 *    trigger "admin" and from ["disputed"]).
 * A freelancer can never reach it: their "complete" means "deliver".
 *
 * Double-payout safety (unchanged from the original completion route):
 *  1. The status flip to 'completed' is one conditional UPDATE — exactly one
 *     concurrent caller wins, and no money moves before it.
 *  2. The transfer uses a deterministic idempotency key per job, so retries
 *     and the losing side of a race converge on the SAME Stripe transfer.
 *  3. The transfer id is persisted right after the transfer. A job left
 *     'completed' with no transfer id (crash window) is retried by the next
 *     approve call or by the auto-release sweep.
 *
 * Disputes freeze release: 'disputed' is never in the default `from` set, so
 * a job the hirer reported (or that was charged back) can't be paid out by
 * approval or auto-release.
 */
import type Stripe from "stripe";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, freelancers, freelancerJobs, users } from "@workspace/db";
import { payoutIdempotencyKey } from "./freelancerEscrow";
import { logger } from "./logger";
import { publishNotification } from "../routes/notifications-feed";

/** Revisions a hirer can request per job before only approve/report remain. */
export const FREELANCER_REVISION_CAP = 3;

/** Hirer reminder lead time before an auto-release. */
export const AUTO_RELEASE_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

const DEFAULT_AUTO_RELEASE_DAYS = 3;

/**
 * Days an untouched delivery waits before it is approved automatically.
 * FREELANCER_AUTO_RELEASE_DAYS (optional) overrides the default of 3; a
 * missing, non-numeric or non-positive value falls back to the default.
 */
export function autoReleaseDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env["FREELANCER_AUTO_RELEASE_DAYS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AUTO_RELEASE_DAYS;
}

export function autoReleaseAtFrom(deliveredAt: Date, env: NodeJS.ProcessEnv = process.env): Date {
  return new Date(deliveredAt.getTime() + autoReleaseDays(env) * 24 * 60 * 60 * 1000);
}

export class FreelancerJobError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export type ReleaseTrigger = "hirer" | "auto" | "admin";
type JobRow = typeof freelancerJobs.$inferSelect;
type FreelancerRow = typeof freelancers.$inferSelect;

export type ReleaseResult = {
  job: JobRow;
  transferId: string | null;
  amountCents: number;
  /** True only for the caller that flipped the job to completed. */
  claimedNow: boolean;
};

async function loadRow(jobId: string): Promise<{ job: JobRow; freelancer: FreelancerRow } | null> {
  const [row] = await db
    .select({ job: freelancerJobs, freelancer: freelancers })
    .from(freelancerJobs)
    .innerJoin(freelancers, eq(freelancers.id, freelancerJobs.freelancerId))
    .where(eq(freelancerJobs.id, jobId))
    .limit(1);
  return row ?? null;
}

function paidOut(job: JobRow): boolean {
  return job.status === "completed" && (!!job.stripeTransferId || job.freelancerPayoutCents <= 0);
}

/**
 * Approve a job and send the freelancer's payout, exactly once.
 * `from` lists the statuses that may be approved (default: delivered only).
 * A job already 'completed' without a transfer id is a crashed earlier
 * release and is retried regardless of `from`.
 */
export async function releaseJobPayout(
  stripe: Stripe,
  jobId: string,
  opts: { trigger: ReleaseTrigger; from?: string[] },
): Promise<ReleaseResult> {
  const from = opts.from ?? ["delivered"];
  const row = await loadRow(jobId);
  if (!row) throw new FreelancerJobError(404, "Job not found");

  if (paidOut(row.job)) {
    return {
      job: row.job,
      transferId: row.job.stripeTransferId ?? null,
      amountCents: row.job.freelancerPayoutCents,
      claimedNow: false,
    };
  }

  const retryingPayout = row.job.status === "completed" && !row.job.stripeTransferId;
  if (!retryingPayout && !from.includes(row.job.status)) {
    throw new FreelancerJobError(409, `Job can't be approved from status '${row.job.status}'`);
  }
  if (row.job.paymentStatus !== "paid") {
    throw new FreelancerJobError(409, "Payment hasn't been confirmed yet", "PAYMENT_NOT_CONFIRMED");
  }
  if (!row.freelancer.stripeAccountId) {
    throw new FreelancerJobError(409, "The freelancer has no payout account connected", "NO_CONNECT_ACCOUNT");
  }

  // The status the job is rolled back to if the payout can't be sent.
  const previousStatus = row.job.status;

  // 1) Atomic claim — flips the status BEFORE any money moves.
  let claimedNow = false;
  if (!retryingPayout) {
    const now = new Date();
    const [claimed] = await db
      .update(freelancerJobs)
      .set({
        status: "completed",
        completedAt: now,
        approvedBy: opts.trigger,
        autoReleaseAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(freelancerJobs.id, jobId),
          inArray(freelancerJobs.status, from),
          eq(freelancerJobs.paymentStatus, "paid"),
        ),
      )
      .returning({ id: freelancerJobs.id });
    claimedNow = !!claimed;

    if (!claimedNow) {
      const fresh = await loadRow(jobId);
      if (!fresh) throw new FreelancerJobError(404, "Job not found");
      if (fresh.job.status !== "completed") {
        throw new FreelancerJobError(409, "Job status changed — refresh and try again");
      }
      if (paidOut(fresh.job)) {
        return {
          job: fresh.job,
          transferId: fresh.job.stripeTransferId ?? null,
          amountCents: fresh.job.freelancerPayoutCents,
          claimedNow: false,
        };
      }
      // Claimed by a caller whose payout isn't persisted yet — fall through;
      // the idempotency key converges both on one transfer.
    }
  }

  const rollback = async () => {
    if (!claimedNow) return;
    await db
      .update(freelancerJobs)
      .set({
        status: previousStatus,
        completedAt: null,
        approvedBy: null,
        // Restore the release clock so an auto-release retries next sweep.
        autoReleaseAt: row.job.autoReleaseAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(freelancerJobs.id, jobId),
          eq(freelancerJobs.status, "completed"),
          isNull(freelancerJobs.stripeTransferId),
        ),
      );
  };

  // 2) Payout transfer — deterministic idempotency key per job.
  let stripeTransferId: string | null = null;
  if (row.job.freelancerPayoutCents > 0) {
    // source_transaction ties the payout to this job's escrow charge; without
    // it the transfer would draw from the platform's general balance.
    let sourceCharge: string | undefined;
    if (row.job.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(row.job.stripePaymentIntentId);
        sourceCharge = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
      } catch (piErr) {
        logger.warn({ err: piErr, jobId }, "Could not retrieve job PaymentIntent");
      }
    }
    if (!sourceCharge) {
      await rollback();
      throw new FreelancerJobError(
        409,
        "Couldn't verify the escrow payment for this job — try again shortly.",
        "SOURCE_CHARGE_UNAVAILABLE",
      );
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: row.job.freelancerPayoutCents,
          currency: "usd",
          destination: row.freelancer.stripeAccountId,
          transfer_group: `freelancer_job_${row.job.id}`,
          source_transaction: sourceCharge,
          metadata: {
            freelancerJobId: row.job.id,
            freelancerId: row.freelancer.id,
            trigger: `job_approved_${opts.trigger}`,
          },
        },
        { idempotencyKey: payoutIdempotencyKey(row.job.id) },
      );
      stripeTransferId = transfer.id;
    } catch (transferErr: any) {
      const idempotencyConflict =
        transferErr?.raw?.type === "idempotency_error" || transferErr?.type === "StripeIdempotencyError";
      if (idempotencyConflict) {
        const existing = await stripe.transfers.list({
          transfer_group: `freelancer_job_${row.job.id}`,
          limit: 10,
        });
        const match = existing.data.find((t) => t.metadata?.["freelancerJobId"] === row.job.id);
        if (!match) throw transferErr;
        stripeTransferId = match.id;
      } else {
        await rollback();
        throw transferErr;
      }
    }

    // 3) Persist the transfer id immediately.
    await db
      .update(freelancerJobs)
      .set({ stripeTransferId, updatedAt: new Date() })
      .where(and(eq(freelancerJobs.id, jobId), isNull(freelancerJobs.stripeTransferId)));
  }

  // Stats increment exactly once — tied to winning the claim.
  if (claimedNow) {
    await db
      .update(freelancers)
      .set({ totalJobsCompleted: sql`${freelancers.totalJobsCompleted} + 1`, updatedAt: new Date() })
      .where(eq(freelancers.id, row.freelancer.id));
  }

  const final = await loadRow(jobId);
  return {
    job: final?.job ?? row.job,
    transferId: final?.job.stripeTransferId ?? stripeTransferId,
    amountCents: row.job.freelancerPayoutCents,
    claimedNow,
  };
}

/**
 * Open freelancer-job disputes, newest first — for the admin disputes area
 * (hirer reports AND chargebacks; both set status 'disputed').
 */
export async function listOpenFreelancerJobDisputes(limit = 100) {
  const rows = await db
    .select({ job: freelancerJobs, freelancerUserId: freelancers.userId })
    .from(freelancerJobs)
    .innerJoin(freelancers, eq(freelancers.id, freelancerJobs.freelancerId))
    .where(eq(freelancerJobs.status, "disputed"))
    .orderBy(desc(freelancerJobs.disputedAt))
    .limit(limit);
  return rows.map((r) => ({
    jobId: r.job.id,
    title: r.job.title,
    hirerId: r.job.sellerId,
    freelancerUserId: r.freelancerUserId,
    agreedPriceCents: r.job.agreedPriceCents,
    freelancerPayoutCents: r.job.freelancerPayoutCents,
    paymentStatus: r.job.paymentStatus,
    stripePaymentIntentId: r.job.stripePaymentIntentId,
    stripeTransferId: r.job.stripeTransferId,
    disputedAt: r.job.disputedAt,
    disputeReason: r.job.disputeReason,
    disputeOpenedBy: r.job.disputeOpenedBy,
    deliveredAt: r.job.deliveredAt,
    deliveryNote: r.job.deliveryNote,
    revisionCount: r.job.revisionCount,
  }));
}

// ─── Notifications (best-effort; never block a state change) ────────────────

export async function displayName(clerkId: string, fallback: string): Promise<string> {
  try {
    const [u] = await db
      .select({ name: users.name, displayName: users.displayName })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    return u?.displayName || u?.name || fallback;
  } catch {
    return fallback;
  }
}

export function notifyJob(
  userId: string,
  jobId: string,
  type: string,
  title: string,
  body: string,
  category: "orders" | "payouts" | "disputes" = "orders",
): void {
  publishNotification({
    userId,
    category,
    type,
    title,
    body,
    targetId: jobId,
    targetType: "freelancer_job",
  }).catch((err) => logger.warn({ err, jobId, type }, "Freelancer job notification failed"));
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}
