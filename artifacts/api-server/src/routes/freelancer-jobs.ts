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
 *  3. When the freelancer marks the job complete, the net amount is sent to
 *     their Connect account via a Stripe transfer (source_transaction ties the
 *     payout to the original charge).
 *  4. Cancelling a paid job (pending/accepted only) refunds the PaymentIntent.
 */
import { Router } from "express";
import { db, freelancers, freelancerJobs, users } from "@workspace/db";
import { and, eq, desc, inArray, isNull, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe, computeApplicationFeeCents } from "../lib/stripe";
import { payoutIdempotencyKey, refundJobPayment } from "../lib/freelancerEscrow";

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

function sendError(res: any, err: any, fallback: string) {
  const status =
    err?.status ??
    (typeof err?.statusCode === "number" && err.statusCode < 500 ? 409 : 500);
  if (status < 500) {
    res.status(status).json({ error: err?.message ?? fallback });
  } else {
    console.error(fallback, err);
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
      console.warn("freelancer hire: Connect account check failed", acctErr);
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

    const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:3000";
    // Domain root + /api/... — matches the dev proxy's verbatim path forwarding.
    const baseUrl = `https://${devDomain}`;

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
    sendError(res, err, "Failed to create job");
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
    console.error("freelancer jobs list:", err);
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
    console.error("freelancer job get:", err);
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
    sendError(res, err, "Failed to sync payment");
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
    sendError(res, err, "Failed to accept job");
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
    sendError(res, err, "Failed to start job");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/complete
 * Freelancer marks the job complete → payout transfer to their Connect account.
 *
 * Double-payout safety:
 *  1. The in_progress → completed flip is a single conditional UPDATE — an
 *     atomic claim only one concurrent request can win. No money moves before
 *     the claim.
 *  2. The transfer uses a deterministic idempotency key per job, so a retry
 *     after a crash — or the losing side of a race — converges on the SAME
 *     Stripe transfer instead of creating a second one.
 *  3. The transfer id is persisted immediately after the transfer; a job left
 *     completed with no transfer id (crash window) is reconciled by calling
 *     this endpoint again.
 */
router.patch("/:id/complete", async (req, res) => {
  try {
    const stripe = requireStripe();
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
      res.status(403).json({ error: "Only the freelancer can complete this job" });
      return;
    }

    // Idempotent success — already completed and paid out (or nothing to pay).
    if (
      row.job.status === "completed" &&
      (row.job.stripeTransferId || row.job.freelancerPayoutCents <= 0)
    ) {
      res.json({
        job: shapeJob(row.job, { role: "freelancer" }),
        payout: {
          amountCents: row.job.freelancerPayoutCents,
          transferId: row.job.stripeTransferId ?? null,
        },
      });
      return;
    }

    // completed + no transfer id = a previous attempt crashed between the
    // claim and the payout; let the payout step run again.
    const retryingPayout = row.job.status === "completed" && !row.job.stripeTransferId;
    if (row.job.status !== "in_progress" && !retryingPayout) {
      res.status(409).json({ error: `Job can't be completed from status '${row.job.status}'` });
      return;
    }
    if (row.job.paymentStatus !== "paid") {
      res.status(409).json({ error: "Payment hasn't been confirmed yet", code: "PAYMENT_NOT_CONFIRMED" });
      return;
    }
    if (!row.freelancer.stripeAccountId) {
      res.status(409).json({ error: "Connect a bank account before completing jobs", code: "NO_CONNECT_ACCOUNT" });
      return;
    }

    // 1) Atomic claim — flips the status BEFORE any money moves. Exactly one
    //    concurrent request wins; everyone else reconciles below.
    let claimedNow = false;
    if (!retryingPayout) {
      const [claimed] = await db
        .update(freelancerJobs)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(freelancerJobs.id, id),
            eq(freelancerJobs.status, "in_progress"),
            eq(freelancerJobs.paymentStatus, "paid"),
          ),
        )
        .returning({ id: freelancerJobs.id });
      claimedNow = !!claimed;

      if (!claimedNow) {
        const fresh = await loadJobWithFreelancer(id);
        if (!fresh) {
          res.status(404).json({ error: "Job not found" });
          return;
        }
        if (fresh.job.status !== "completed") {
          res.status(409).json({ error: "Job status changed — refresh and try again" });
          return;
        }
        if (fresh.job.stripeTransferId) {
          // The concurrent winner already paid out — idempotent success.
          res.json({
            job: shapeJob(fresh.job, { role: "freelancer" }),
            payout: {
              amountCents: fresh.job.freelancerPayoutCents,
              transferId: fresh.job.stripeTransferId,
            },
          });
          return;
        }
        // Claimed by a request whose payout isn't persisted yet — fall
        // through; the idempotency key converges both on one transfer.
      }
    }

    // 2) Payout transfer — deterministic idempotency key per job.
    let stripeTransferId: string | null = null;
    if (row.job.freelancerPayoutCents > 0) {
      // source_transaction ties the payout to this job's escrow charge; a
      // transfer without it would draw from the platform's GENERAL balance —
      // unrelated funds. So the charge is mandatory: no charge, no transfer.
      let sourceCharge: string | undefined;
      if (row.job.stripePaymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(row.job.stripePaymentIntentId);
          sourceCharge =
            typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
        } catch (piErr) {
          console.warn("freelancer job complete: couldn't retrieve PaymentIntent", piErr);
        }
      }
      if (!sourceCharge) {
        // Fail safely and stay retryable: roll the claim back instead of
        // paying out untied funds.
        if (claimedNow) {
          await db
            .update(freelancerJobs)
            .set({ status: "in_progress", completedAt: null, updatedAt: new Date() })
            .where(
              and(
                eq(freelancerJobs.id, id),
                eq(freelancerJobs.status, "completed"),
                isNull(freelancerJobs.stripeTransferId),
              ),
            );
        }
        res.status(409).json({
          error: "Couldn't verify the escrow payment for this job — try again shortly.",
          code: "SOURCE_CHARGE_UNAVAILABLE",
        });
        return;
      }

      try {
        const transfer = await stripe.transfers.create(
          {
            amount:         row.job.freelancerPayoutCents,
            currency:       "usd",
            destination:    row.freelancer.stripeAccountId,
            transfer_group: `freelancer_job_${row.job.id}`,
            source_transaction: sourceCharge,
            metadata: {
              freelancerJobId: row.job.id,
              freelancerId:    row.freelancer.id,
              trigger:         "job_complete",
            },
          },
          { idempotencyKey: payoutIdempotencyKey(row.job.id) },
        );
        stripeTransferId = transfer.id;
      } catch (transferErr: any) {
        const idempotencyConflict =
          transferErr?.raw?.type === "idempotency_error" ||
          transferErr?.type === "StripeIdempotencyError";
        if (idempotencyConflict) {
          // Same key, different params or still in flight — the transfer
          // already exists (or is being created); find it by transfer group.
          const existing = await stripe.transfers.list({
            transfer_group: `freelancer_job_${row.job.id}`,
            limit: 10,
          });
          const match = existing.data.find(
            (t) => t.metadata?.["freelancerJobId"] === row.job.id,
          );
          if (!match) throw transferErr;
          stripeTransferId = match.id;
        } else {
          // Transfer genuinely failed. Roll the claim back so the freelancer
          // can retry once the problem (e.g. Connect account) is fixed.
          if (claimedNow) {
            await db
              .update(freelancerJobs)
              .set({ status: "in_progress", completedAt: null, updatedAt: new Date() })
              .where(
                and(
                  eq(freelancerJobs.id, id),
                  eq(freelancerJobs.status, "completed"),
                  isNull(freelancerJobs.stripeTransferId),
                ),
              );
          }
          throw transferErr;
        }
      }

      // 3) Persist the transfer id immediately, before anything else can fail.
      await db
        .update(freelancerJobs)
        .set({ stripeTransferId, updatedAt: new Date() })
        .where(and(eq(freelancerJobs.id, id), isNull(freelancerJobs.stripeTransferId)));
    }

    // Stats increment exactly once — tied to winning the claim.
    if (claimedNow) {
      await db
        .update(freelancers)
        .set({
          totalJobsCompleted: sql`${freelancers.totalJobsCompleted} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(freelancers.id, row.freelancer.id));
    }

    const final = await loadJobWithFreelancer(id);
    res.json({
      job: shapeJob(final?.job ?? row.job, { role: "freelancer" }),
      payout: {
        amountCents: row.job.freelancerPayoutCents,
        transferId: final?.job.stripeTransferId ?? stripeTransferId,
      },
    });
  } catch (err: any) {
    sendError(res, err, "Failed to complete job");
  }
});

/**
 * PATCH /api/freelancer-jobs/:id/cancel
 * Hirer or freelancer cancels — from pending/accepted, or from in_progress
 * BEFORE any payout. The in_progress case is the recovery path when a payout
 * can't be delivered (e.g. the freelancer's account became restricted):
 * completion rolls back to in_progress, and cancelling refunds the hirer.
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

    if (
      row.job.status !== "pending" &&
      row.job.status !== "accepted" &&
      row.job.status !== "in_progress"
    ) {
      res.status(409).json({
        error: "Only pending, accepted, or in-progress jobs can be cancelled",
      });
      return;
    }

    // 1) Atomic claim — nothing is refunded/expired unless this wins, so a
    //    concurrent accept/start/complete can't interleave with the cleanup.
    const [claimed] = await db
      .update(freelancerJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(freelancerJobs.id, id),
          inArray(freelancerJobs.status, ["pending", "accepted", "in_progress"]),
          isNull(freelancerJobs.stripeTransferId),
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
        console.warn("freelancer job cancel: session check failed", sessionErr);
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
    sendError(res, err, "Failed to cancel job");
  }
});

export default router;
