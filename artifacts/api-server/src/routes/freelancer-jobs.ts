/**
 * Freelancer job lifecycle + escrow payments.
 * Mounted at /api/freelancer-jobs — all routes (except the browser landing
 * pages Stripe redirects to) require Clerk auth.
 *
 * Escrow model (separate charges & transfers — same mechanism as drop wallets):
 *  1. The hirer pays the full agreed price via Stripe Checkout; the charge
 *     lands on the PLATFORM account (no transfer_data / application fee).
 *  2. platformFeeCents (5%, PLATFORM_COMMISSION_RATE) and
 *     freelancerPayoutCents are recorded on the job row at creation.
 *  3. The freelancer DELIVERS the work (no money moves). The hirer approves,
 *     requests a revision (max 3), or reports a problem (→ 'disputed', which
 *     freezes the payout). An untouched delivery is approved automatically
 *     after FREELANCER_AUTO_RELEASE_DAYS (default 3).
 *  4. Only approval (hirer or auto-release) sends the net amount to the
 *     freelancer's Connect account (lib/freelancerRelease.ts; source_transaction
 *     ties the payout to the original charge). A freelancer can never trigger
 *     their own payout.
 *  5. Cancelling a paid job refunds the PaymentIntent (see the cancel route).
 */
import { Router } from "express";
import { db, freelancers, freelancerJobs, users } from "@workspace/db";
import { and, eq, desc, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { getWebOrigin } from "../lib/webOrigin";
import { requireStripe, computeApplicationFeeCents } from "../lib/stripe";
import { refundJobPayment } from "../lib/freelancerEscrow";
import {
  FREELANCER_REVISION_CAP,
  autoReleaseAtFrom,
  autoReleaseDays,
  displayName,
  formatDays,
  formatUsd,
  notifyJob,
  releaseJobPayout,
} from "../lib/freelancerRelease";
import { logger } from "../lib/logger";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER_FIELDS = {
  name:            users.name,
  displayName:     users.displayName,
  avatarUrl:       users.avatarUrl,
  profileImageUrl: users.profileImageUrl,
};

type JobRow = typeof freelancerJobs.$inferSelect;

function shapeJob(job: JobRow, extras: Record<string, unknown> = {}) {
  return {
    id:                    job.id,
    freelancerId:          job.freelancerId,
    sellerId:              job.sellerId,
    title:                 job.title,
    description:           job.description,
    agreedPriceCents:      job.agreedPriceCents,
    status:                job.status,
    paymentStatus:         job.paymentStatus,
    platformFeeCents:      job.platformFeeCents,
    freelancerPayoutCents: job.freelancerPayoutCents,
    completedAt:           job.completedAt,
    deliveredAt:           job.deliveredAt,
    deliveryNote:          job.deliveryNote,
    revisionCount:         job.revisionCount,
    revisionsLeft:         Math.max(0, FREELANCER_REVISION_CAP - job.revisionCount),
    revisionNote:          job.revisionNote,
    autoReleaseAt:         job.autoReleaseAt,
    approvedBy:            job.approvedBy,
    disputedAt:            job.disputedAt,
    disputeReason:         job.disputeReason,
    createdAt:             job.createdAt,
    updatedAt:             job.updatedAt,
    ...extras,
  };
}

async function loadJobWithFreelancer(jobId: string) {
  const [row] = await db
    .select({ job: freelancerJobs, freelancer: freelancers })
    .from(freelancerJobs)
    .innerJoin(freelancers, eq(freelancers.id, freelancerJobs.freelancerId))
    .where(eq(freelancerJobs.id, jobId))
    .limit(1);
  return row ?? null;
}

function roleFor(
  row: { job: JobRow; freelancer: typeof freelancers.$inferSelect },
  clerkUserId: string,
): "hirer" | "freelancer" | null {
  if (row.job.sellerId === clerkUserId) return "hirer";
  if (row.freelancer.userId === clerkUserId) return "freelancer";
  return null;
}

function sendError(req: any, res: any, err: any, fallback: string) {
  const status =
    err?.status ??
    (typeof err?.statusCode === "number" && err.statusCode < 500 ? 409 : 500);
  if (status < 500) {
    res.status(status).json({
      error: err?.message ?? fallback,
      ...(typeof err?.code === "string" && err?.status ? { code: err.code } : {}),
    });
  } else {
    (req.log ?? logger).error({ err }, fallback);
    res.status(500).json({ error: fallback });
  }
}

// ─── Browser landing pages (no auth — hit by the Stripe redirect) ─────────────

router.get("/checkout/return", (_req, res) => {
  res.json({ message: "Payment received. You can close this window and return to the app." });
});

router.get("/checkout/cancelled", (_req, res) => {
  res.json({ message: "Checkout cancelled. You can close this window and return to the app." });
});

router.use(requireAuth);

/**
 * POST /api/freelancer-jobs
 * Hirer creates a job and gets a Stripe Checkout URL for the escrow payment.
 * Body: { freelancerId, title, description?, agreedPriceCents, successUrl?, cancelUrl? }
 * Returns 201 { job, checkoutUrl, sessionId }.
 */
router.post("/", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;
    const { freelancerId, title, description = "", agreedPriceCents, successUrl, cancelUrl } = req.body ?? {};

    if (typeof freelancerId !== "string" || !UUID_RE.test(freelancerId)) {
      res.status(400).json({ error: "freelancerId is required" });
      return;
    }
    const cleanTitle = typeof title === "string" ? title.trim().slice(0, 200) : "";
    if (!cleanTitle) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const cleanDesc = typeof description === "string" ? description.trim().slice(0, 5000) : "";
    const price = Number(agreedPriceCents);
    if (!Number.isInteger(price) || price < 100 || price > 5_000_000) {
      res.status(400).json({ error: "agreedPriceCents must be an integer between 100 ($1) and 5000000 ($50,000)" });
      return;
    }

    const [freelancer] = await db
      .select()
      .from(freelancers)
      .where(eq(freelancers.id, freelancerId))
      .limit(1);

    if (!freelancer || !freelancer.isActive) {
      res.status(404).json({ error: "Freelancer not found" });
      return;
    }
    if (freelancer.userId === clerkUserId) {
      res.status(400).json({ error: "You can't hire yourself" });
      return;
    }
    if (!freelancer.stripeAccountId) {
      res.status(409).json({
        error: "This freelancer hasn't set up payouts yet and can't accept paid jobs.",
        code: "FREELANCER_NOT_PAYABLE",
      });
      return;
    }

    // An account id alone isn't enough — a partially onboarded or restricted
    // Express account can't receive transfers, which would strand escrow
    // funds. Verify live capability before taking the hirer's money.
    let payoutsReady = false;
    try {
      const account = await stripe.accounts.retrieve(freelancer.stripeAccountId);
      payoutsReady =
        (account as any).payouts_enabled === true &&
        (account as any).capabilities?.transfers === "active";
      const liveStatus = payoutsReady
        ? "active"
        : (account as any).details_submitted
          ? "restricted"
          : "pending";
      if (liveStatus !== freelancer.stripeAccountStatus) {
        await db
          .update(freelancers)
          .set({ stripeAccountStatus: liveStatus, updatedAt: new Date() })
          .where(eq(freelancers.id, freelancer.id));
      }
    } catch (acctErr) {
      req.log.warn({ err: acctErr, freelancerId }, "Freelancer Connect account check failed");
    }
    if (!payoutsReady) {
      res.status(409).json({
        error:
          "This freelancer's payout account isn't fully set up yet and can't accept paid jobs.",
        code: "FREELANCER_NOT_PAYABLE",
      });
      return;
    }

    const platformFeeCents = computeApplicationFeeCents(price);
    const freelancerPayoutCents = price - platformFeeCents;

    const [job] = await db
      .insert(freelancerJobs)
      .values({
        freelancerId,
        sellerId: clerkUserId,
        title: cleanTitle,
        description: cleanDesc,
        agreedPriceCents: price,
        platformFeeCents,
        freelancerPayoutCents,
      })
      .returning();

    // Domain root + /api/... — matches the dev proxy's verbatim path forwarding.
    const baseUrl = getWebOrigin("https://localhost:3000");

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Freelance job: ${cleanTitle}`.slice(0, 250),
                description: "Brandthread freelancer marketplace — funds held until the job is completed",
              },
              unit_amount: price,
            },
            quantity: 1,
          },
        ],
        success_url:
          typeof successUrl === "string" && successUrl
            ? successUrl
            : `${baseUrl}/api/freelancer-jobs/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:
          typeof cancelUrl === "string" && cancelUrl
            ? cancelUrl
            : `${baseUrl}/api/freelancer-jobs/checkout/cancelled`,
        client_reference_id: clerkUserId,
        metadata: { freelancerJobId: job.id, kind: "freelancer_job" },
        payment_intent_data: {
          // Escrow: no transfer_data — the charge stays on the platform account
          // until the job is completed and the payout transfer is created.
          transfer_group: `freelancer_job_${job.id}`,
          metadata: { freelancerJobId: job.id, freelancerId, hirerId: clerkUserId },
        },
      });
    } catch (stripeErr) {
      // Roll back the orphan row so a failed Stripe call leaves no debris
      await db.delete(freelancerJobs).where(eq(freelancerJobs.id, job.id));
      throw stripeErr;
    }

    const piId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    const [updated] = await db
      .update(freelancerJobs)
      .set({
        stripeCheckoutSessionId: session.id,
        ...(piId ? { stripePaymentIntentId: piId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(freelancerJobs.id, job.id))
      .returning();

    res.status(201).json({ job: shapeJob(updated), checkoutUrl: session.url, sessionId: session.id });
  } catch (err: any) {
    sendError(req, res, err, "Failed to create job");
  }
});

/**
 * GET /api/freelancer-jobs
 * Jobs for the current user, split by role.
 * Returns { isFreelancer, asHirer: [...], asFreelancer: [...] }.
 */
router.get("/", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;

    const [myFreelancer] = await db
      .select({ id: freelancers.id })
      .from(freelancers)
      .where(eq(freelancers.userId, clerkUserId))
      .limit(1);

    const hirerRows = await db
      .select({ job: freelancerJobs, freelancer: freelancers, user: USER_FIELDS })
      .from(freelancerJobs)
      .innerJoin(freelancers, eq(freelancers.id, freelancerJobs.freelancerId))
      .leftJoin(users, eq(users.clerkId, freelancers.userId))
      .where(eq(freelancerJobs.sellerId, clerkUserId))
      .orderBy(desc(freelancerJobs.createdAt))
      .limit(100);

    let freelancerRows: { job: JobRow; user: any }[] = [];
    if (myFreelancer) {
      freelancerRows = await db
        .select({ job: freelancerJobs, user: USER_FIELDS })
        .from(freelancerJobs)
        .leftJoin(users, eq(users.clerkId, freelancerJobs.sellerId))
        .where(eq(freelancerJobs.freelancerId, myFreelancer.id))
        .orderBy(desc(freelancerJobs.createdAt))
        .limit(100);
    }

    res.json({
      isFreelancer: !!myFreelancer,
      asHirer: hirerRows.map((r) =>
        shapeJob(r.job, {
          role: "hirer",
          freelancerName: r.user?.displayName || r.user?.name || "Freelancer",
          freelancerAvatarUrl: r.user?.profileImageUrl || r.user?.avatarUrl || null,
          serviceType: r.freelancer.serviceType,
        }),
      ),
      asFreelancer: freelancerRows.map((r) =>
        shapeJob(r.job, {
          role: "freelancer",
          hirerName: r.user?.displayName || r.user?.name || "Seller",
          hirerAvatarUrl: r.user?.profileImageUrl || r.user?.avatarUrl || null,
        }),
      ),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list freelancer jobs");
    res.status(500).json({ error: "Failed to load jobs" });
  }
});

/**
 * GET /api/freelancer-jobs/:id — participants only.
 */
router.get("/:id", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const role = roleFor(row, clerkUserId);
    if (!role) {
      res.status(403).json({ error: "Not your job" });
      return;
    }

    const parties = await db
      .select({ clerkId: users.clerkId, ...USER_FIELDS })
      .from(users)
      .where(inArray(users.clerkId, [row.job.sellerId, row.freelancer.userId]));

    const byId = new Map(parties.map((p) => [p.clerkId, p]));
    const fUser = byId.get(row.freelancer.userId);
    const hUser = byId.get(row.job.sellerId);

    res.json({
      job: shapeJob(row.job, {
        role,
        serviceType: row.freelancer.serviceType,
        freelancerUserId: row.freelancer.userId,
        freelancerName: fUser?.displayName || fUser?.name || "Freelancer",
        freelancerAvatarUrl: fUser?.profileImageUrl || fUser?.avatarUrl || null,
        hirerName: hUser?.displayName || hUser?.name || "Seller",
        hirerAvatarUrl: hUser?.profileImageUrl || hUser?.avatarUrl || null,
      }),
    });
  } catch (err) {
    req.log.error({ err, jobId: req.params.id }, "Failed to load freelancer job");
    res.status(500).json({ error: "Failed to load job" });
  }
});

/**
 * POST /api/freelancer-jobs/:id/sync-payment
 * Re-checks the Stripe Checkout session (webhooks can lag in dev) and marks
 * the job paid when Stripe says so. Participants only.
 */
router.post("/:id/sync-payment", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const role = roleFor(row, clerkUserId);
    if (!role) {
      res.status(403).json({ error: "Not your job" });
      return;
    }

    if (row.job.paymentStatus === "refunded") {
      res.json({ job: shapeJob(row.job, { role }), paymentStatus: "refunded" });
      return;
    }
    if (row.job.paymentStatus === "paid") {
      res.json({ job: shapeJob(row.job, { role }), paymentStatus: "paid" });
      return;
    }
    if (!row.job.stripeCheckoutSessionId) {
      res.status(409).json({ error: "No checkout session for this job" });
      return;
    }

    const stripe = requireStripe();
    const session = await stripe.checkout.sessions.retrieve(row.job.stripeCheckoutSessionId);

    if (session.payment_status === "paid") {
      const piId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      // Guarded: never mark a cancelled job as paid.
      const [updated] = await db
        .update(freelancerJobs)
        .set({
          paymentStatus: "paid",
          ...(piId ? { stripePaymentIntentId: piId } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(freelancerJobs.id, row.job.id),
            eq(freelancerJobs.paymentStatus, "unpaid"),
            ne(freelancerJobs.status, "cancelled"),
          ),
        )
        .returning();
      if (updated) {
        res.json({ job: shapeJob(updated, { role }), paymentStatus: "paid" });
        return;
      }

      // The job was cancelled meanwhile — refund the late payment instead of
      // recording it.
      const fresh = await loadJobWithFreelancer(row.job.id);
      if (
        fresh &&
        fresh.job.status === "cancelled" &&
        fresh.job.paymentStatus !== "refunded" &&
        piId
      ) {
        await refundJobPayment(stripe, {
          jobId: row.job.id,
          paymentIntentId: piId,
          context: "sync_after_cancel",
        });
        const [refunded] = await db
          .update(freelancerJobs)
          .set({ paymentStatus: "refunded", stripePaymentIntentId: piId, updatedAt: new Date() })
          .where(eq(freelancerJobs.id, row.job.id))
          .returning();
        res.json({ job: shapeJob(refunded ?? fresh.job, { role }), paymentStatus: "refunded" });
        return;
      }
      res.json({
        job: shapeJob(fresh?.job ?? row.job, { role }),
        paymentStatus: fresh?.job.paymentStatus ?? row.job.paymentStatus,
      });
    } else {
      res.json({ job: shapeJob(row.job, { role }), paymentStatus: session.payment_status });
    }
  } catch (err: any) {
    sendError(req, res, err, "Failed to sync payment");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/accept — freelancer accepts a paid job.
 */
router.patch("/:id/accept", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (roleFor(row, clerkUserId) !== "freelancer") {
      res.status(403).json({ error: "Only the freelancer can accept this job" });
      return;
    }
    if (row.job.status !== "pending") {
      res.status(409).json({ error: `Job can't be accepted from status '${row.job.status}'` });
      return;
    }
    if (row.job.paymentStatus !== "paid") {
      res.status(409).json({
        error: "Payment hasn't been confirmed yet. The hirer needs to complete checkout first.",
        code: "PAYMENT_NOT_CONFIRMED",
      });
      return;
    }

    const [updated] = await db
      .update(freelancerJobs)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(and(eq(freelancerJobs.id, id), eq(freelancerJobs.status, "pending")))
      .returning();

    if (!updated) {
      res.status(409).json({ error: "Job status changed — refresh and try again" });
      return;
    }
    res.json({ job: shapeJob(updated, { role: "freelancer" }) });
  } catch (err) {
    sendError(req, res, err, "Failed to accept job");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/start — freelancer marks work in progress.
 */
router.patch("/:id/start", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (roleFor(row, clerkUserId) !== "freelancer") {
      res.status(403).json({ error: "Only the freelancer can start this job" });
      return;
    }
    if (row.job.status !== "accepted") {
      res.status(409).json({ error: `Job can't be started from status '${row.job.status}'` });
      return;
    }

    const [updated] = await db
      .update(freelancerJobs)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(and(eq(freelancerJobs.id, id), eq(freelancerJobs.status, "accepted")))
      .returning();

    if (!updated) {
      res.status(409).json({ error: "Job status changed — refresh and try again" });
      return;
    }
    res.json({ job: shapeJob(updated, { role: "freelancer" }) });
  } catch (err) {
    sendError(req, res, err, "Failed to start job");
  }
});

/**
 * Freelancer delivers the work (BT-446). No money moves here — the payout is
 * released only when the hirer approves, or automatically after
 * FREELANCER_AUTO_RELEASE_DAYS with no hirer action (jobs/freelancerAutoRelease).
 * Body: { note? } — an optional delivery message (max 2000 chars).
 */
async function deliverJob(req: any, res: any, legacyComplete: boolean) {
  const { id } = req.params;
  const row = await loadJobWithFreelancer(id);
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const shapeDelivered = (job: JobRow) =>
    legacyComplete
      ? {
          job: shapeJob(job, { role: "freelancer" }),
          // Older app builds read `payout` from this response. Nothing is
          // transferred on delivery; transferId stays null until approval.
          payout: { amountCents: job.freelancerPayoutCents, transferId: job.stripeTransferId ?? null },
          delivered: true,
        }
      : { job: shapeJob(job, { role: "freelancer" }) };

  // Idempotent: delivering twice (double tap / retry) returns the delivery.
  if (row.job.status === "delivered" || row.job.status === "completed") {
    res.json(shapeDelivered(row.job));
    return;
  }
  if (row.job.status !== "in_progress") {
    res.status(409).json({ error: `Job can't be delivered from status '${row.job.status}'` });
    return;
  }
  if (row.job.paymentStatus !== "paid") {
    res.status(409).json({ error: "Payment hasn't been confirmed yet", code: "PAYMENT_NOT_CONFIRMED" });
    return;
  }

  const rawNote = req.body?.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") {
    res.status(400).json({ error: "note must be text" });
    return;
  }
  const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 2000) : "";

  const now = new Date();
  const [updated] = await db
    .update(freelancerJobs)
    .set({
      status: "delivered",
      deliveredAt: now,
      deliveryNote: note || null,
      autoReleaseAt: autoReleaseAtFrom(now),
      autoReleaseRemindedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(freelancerJobs.id, id),
        eq(freelancerJobs.status, "in_progress"),
        eq(freelancerJobs.paymentStatus, "paid"),
      ),
    )
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Job status changed — refresh and try again" });
    return;
  }

  const name = await displayName(row.freelancer.userId, "Your freelancer");
  notifyJob(
    updated.sellerId,
    updated.id,
    "freelancer_job_delivered",
    "Work delivered",
    `${name} delivered "${updated.title}". Approve it or request a revision within ${formatDays(autoReleaseDays())}, or it's marked complete and paid out.`,
  );
  res.json(shapeDelivered(updated));
}

router.patch("/:id/deliver", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (roleFor(row, clerkUserId) !== "freelancer") {
      res.status(403).json({ error: "Only the freelancer can deliver this job" });
      return;
    }
    await deliverJob(req, res, false);
  } catch (err: any) {
    sendError(req, res, err, "Failed to deliver job");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/complete — kept for older app builds.
 *  - Freelancer: means "deliver" (no payout — see BT-446). A freelancer can
 *    never trigger their own payout.
 *  - Hirer: means "approve" (same as /approve).
 */
router.patch("/:id/complete", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const role = roleFor(row, clerkUserId);
    if (role === "freelancer") {
      await deliverJob(req, res, true);
      return;
    }
    if (role === "hirer") {
      await approveJob(req, res, row);
      return;
    }
    res.status(403).json({ error: "Not your job" });
  } catch (err: any) {
    sendError(req, res, err, "Failed to complete job");
  }
});

/**
 * Hirer approves the delivery → completed + payout transfer (exactly once;
 * see lib/freelancerRelease.ts). Also retries a payout left unsent by a crash.
 */
async function approveJob(
  req: any,
  res: any,
  row: NonNullable<Awaited<ReturnType<typeof loadJobWithFreelancer>>>,
) {
  if (row.job.status === "disputed") {
    res.status(409).json({
      error: "This job is under review by Brandthread. Payment is on hold until it's resolved.",
      code: "JOB_DISPUTED",
    });
    return;
  }
  const stripe = requireStripe();
  const result = await releaseJobPayout(stripe, row.job.id, { trigger: "hirer" });
  if (result.claimedNow) {
    const hirer = await displayName(row.job.sellerId, "The hirer");
    notifyJob(
      row.freelancer.userId,
      row.job.id,
      "freelancer_job_approved",
      "Payment released",
      `${hirer} approved "${row.job.title}". ${formatUsd(result.amountCents)} is on its way to your bank account.`,
      "payouts",
    );
  }
  res.json({
    job: shapeJob(result.job, { role: "hirer" }),
    payout: { amountCents: result.amountCents, transferId: result.transferId },
  });
}

router.patch("/:id/approve", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (roleFor(row, clerkUserId) !== "hirer") {
      res.status(403).json({ error: "Only the hirer can approve this job" });
      return;
    }
    await approveJob(req, res, row);
  } catch (err: any) {
    sendError(req, res, err, "Failed to approve job");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/request-revision — hirer sends a delivery
 * back (delivered → in_progress). Body: { note } (required, max 2000).
 * Capped at FREELANCER_REVISION_CAP (3) per job; after that the hirer can
 * approve or report a problem.
 */
router.patch("/:id/request-revision", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (roleFor(row, clerkUserId) !== "hirer") {
      res.status(403).json({ error: "Only the hirer can request a revision" });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
    if (!note) {
      res.status(400).json({ error: "Tell the freelancer what to change" });
      return;
    }
    if (row.job.status !== "delivered") {
      res.status(409).json({ error: `A revision can't be requested from status '${row.job.status}'` });
      return;
    }
    if (row.job.revisionCount >= FREELANCER_REVISION_CAP) {
      res.status(409).json({
        error: `You've used all ${FREELANCER_REVISION_CAP} revisions. Approve the delivery or report a problem.`,
        code: "REVISION_LIMIT",
      });
      return;
    }

    const [updated] = await db
      .update(freelancerJobs)
      .set({
        status: "in_progress",
        revisionCount: sql`${freelancerJobs.revisionCount} + 1`,
        revisionNote: note,
        autoReleaseAt: null,
        autoReleaseRemindedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(freelancerJobs.id, id),
          eq(freelancerJobs.status, "delivered"),
          lt(freelancerJobs.revisionCount, FREELANCER_REVISION_CAP),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Job status changed — refresh and try again" });
      return;
    }

    const hirer = await displayName(updated.sellerId, "The hirer");
    notifyJob(
      row.freelancer.userId,
      updated.id,
      "freelancer_job_revision",
      "Revision requested",
      `${hirer} asked for changes to "${updated.title}": ${note.slice(0, 140)}`,
    );
    res.json({ job: shapeJob(updated, { role: "hirer" }) });
  } catch (err: any) {
    sendError(req, res, err, "Failed to request revision");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/dispute — hirer reports a problem
 * (in_progress | delivered → disputed). Freezes the payout: approval and
 * auto-release never claim a disputed job. Brandthread resolves it from the
 * admin disputes area (lib/freelancerRelease listOpenFreelancerJobDisputes).
 * Body: { reason } (required, max 2000).
 */
router.patch("/:id/dispute", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (roleFor(row, clerkUserId) !== "hirer") {
      res.status(403).json({ error: "Only the hirer can report a problem with this job" });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 2000) : "";
    if (!reason) {
      res.status(400).json({ error: "Describe the problem" });
      return;
    }
    if (row.job.status === "disputed") {
      res.json({ job: shapeJob(row.job, { role: "hirer" }) });
      return;
    }
    if (row.job.status !== "delivered" && row.job.status !== "in_progress") {
      res.status(409).json({ error: `A problem can't be reported from status '${row.job.status}'` });
      return;
    }
    if (row.job.paymentStatus !== "paid") {
      res.status(409).json({ error: "Payment hasn't been confirmed yet", code: "PAYMENT_NOT_CONFIRMED" });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(freelancerJobs)
      .set({
        status: "disputed",
        disputedAt: now,
        disputeReason: reason,
        disputeOpenedBy: "hirer",
        autoReleaseAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(freelancerJobs.id, id),
          inArray(freelancerJobs.status, ["delivered", "in_progress"]),
          isNull(freelancerJobs.stripeTransferId),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Job status changed — refresh and try again" });
      return;
    }

    const hirer = await displayName(updated.sellerId, "The hirer");
    notifyJob(
      row.freelancer.userId,
      updated.id,
      "freelancer_job_disputed",
      "Problem reported",
      `${hirer} reported a problem with "${updated.title}". Payment is on hold while Brandthread reviews it.`,
      "disputes",
    );
    res.json({ job: shapeJob(updated, { role: "hirer" }) });
  } catch (err: any) {
    sendError(req, res, err, "Failed to report a problem");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/cancel
 * Hirer or freelancer cancels — from pending/accepted, or from in_progress
 * BEFORE any payout. The in_progress case is the recovery path when a payout
 * can't be delivered (e.g. the freelancer's account became restricted).
 * After work has been delivered (BT-446):
 *  - the freelancer may still cancel (delivered or in revision) → refund;
 *  - the hirer may not cancel once a delivery exists — they approve, request
 *    a revision, or report a problem instead (otherwise "receive the work,
 *    cancel for a refund" would bypass the review step);
 *  - a disputed job can't be cancelled from the app; Brandthread resolves it.
 *
 * Order matters: the job is atomically claimed as cancelled FIRST, then the
 * Stripe cleanup runs. Paid jobs are refunded (deterministic idempotency
 * key); unpaid jobs get their Checkout Session expired so the stale payment
 * link dies. If the buyer paid inside the race window, the payment is
 * refunded on the spot — and the webhook / sync-payment paths refund late
 * arrivals the same way, so a cancelled job can never end up "paid".
 * Calling cancel again on a cancelled-but-still-paid job retries the refund.
 */
router.patch("/:id/cancel", async (req, res) => {
  try {
    const clerkUserId = (req as any).clerkUserId as string;
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const row = await loadJobWithFreelancer(id);
    if (!row) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const role = roleFor(row, clerkUserId);
    if (!role) {
      res.status(403).json({ error: "Not your job" });
      return;
    }

    // Retry path: cancelled, but the refund didn't go through last time.
    if (row.job.status === "cancelled") {
      if (row.job.paymentStatus === "paid" && row.job.stripePaymentIntentId) {
        const stripe = requireStripe();
        await refundJobPayment(stripe, {
          jobId: id,
          paymentIntentId: row.job.stripePaymentIntentId,
          context: "cancel_retry",
        });
        const [updated] = await db
          .update(freelancerJobs)
          .set({ paymentStatus: "refunded", updatedAt: new Date() })
          .where(eq(freelancerJobs.id, id))
          .returning();
        res.json({ job: shapeJob(updated ?? row.job, { role }) });
        return;
      }
      res.status(409).json({ error: "Job is already cancelled" });
      return;
    }

    if (row.job.status === "disputed") {
      res.status(409).json({
        error: "This job is under review by Brandthread and can't be cancelled.",
        code: "JOB_DISPUTED",
      });
      return;
    }
    const hasDelivery = !!row.job.deliveredAt;
    if (role === "hirer" && hasDelivery && (row.job.status === "delivered" || row.job.status === "in_progress")) {
      res.status(409).json({
        error: "The work has been delivered. Approve it, request a revision, or report a problem.",
        code: "JOB_DELIVERED",
      });
      return;
    }
    const cancellable =
      role === "freelancer"
        ? ["pending", "accepted", "in_progress", "delivered"]
        : ["pending", "accepted", "in_progress"];
    if (!cancellable.includes(row.job.status)) {
      res.status(409).json({
        error: "Only pending, accepted, or in-progress jobs can be cancelled",
      });
      return;
    }

    // 1) Atomic claim — nothing is refunded/expired unless this wins, so a
    //    concurrent accept/start/complete can't interleave with the cleanup.
    const [claimed] = await db
      .update(freelancerJobs)
      .set({ status: "cancelled", autoReleaseAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(freelancerJobs.id, id),
          inArray(freelancerJobs.status, cancellable),
          isNull(freelancerJobs.stripeTransferId),
          // Re-checked atomically: a delivery landing mid-request blocks a
          // hirer cancel just like the pre-check above.
          ...(role === "hirer" ? [isNull(freelancerJobs.deliveredAt)] : []),
        ),
      )
      .returning();
    if (!claimed) {
      res.status(409).json({ error: "Job status changed — refresh and try again" });
      return;
    }

    // 2) Stripe cleanup. A failure here leaves the job cancelled; calling
    //    cancel again retries just the refund (see retry path above).
    let paymentStatus = claimed.paymentStatus;
    let paymentIntentId = claimed.stripePaymentIntentId;

    if (paymentStatus === "paid" && paymentIntentId) {
      const stripe = requireStripe();
      await refundJobPayment(stripe, { jobId: id, paymentIntentId, context: "cancel" });
      paymentStatus = "refunded";
    } else if (paymentStatus === "unpaid" && claimed.stripeCheckoutSessionId) {
      const stripe = requireStripe();
      // Kill the open payment link so it can't be completed after the fact.
      try {
        await stripe.checkout.sessions.expire(claimed.stripeCheckoutSessionId);
      } catch {
        // Already expired — or already completed; the retrieve below decides.
      }
      try {
        const session = await stripe.checkout.sessions.retrieve(claimed.stripeCheckoutSessionId);
        if (session.payment_status === "paid") {
          // The buyer paid inside the race window — refund immediately.
          const piId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null;
          if (piId) {
            paymentIntentId = piId;
            await refundJobPayment(stripe, {
              jobId: id,
              paymentIntentId: piId,
              context: "cancel_late_payment",
            });
            paymentStatus = "refunded";
          }
        }
      } catch (sessionErr) {
        req.log.warn({ err: sessionErr, jobId: id }, "Freelancer job cancellation session check failed");
      }
    }

    const [updated] = await db
      .update(freelancerJobs)
      .set({
        paymentStatus,
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(freelancerJobs.id, id))
      .returning();

    res.json({ job: shapeJob(updated ?? claimed, { role }) });
  } catch (err: any) {
    sendError(req, res, err, "Failed to cancel job");
  }
});

export default router;
