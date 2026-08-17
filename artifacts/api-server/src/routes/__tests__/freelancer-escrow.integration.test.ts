/**
 * Integration tests for the freelancer escrow payment-integrity guarantees:
 *  A. concurrent completion cannot double-pay (atomic claim + idempotency key)
 *  B. a crash between the completion claim and persisting the transfer is
 *     reconciled on retry without creating a second transfer
 *  C. cancellation expires the checkout link, and payments that land after
 *     cancellation are refunded — never recorded as paid
 *
 * Runs against the real dev Postgres (rows are seeded/cleaned per run) with
 * Stripe replaced by an in-memory fake that honors idempotency keys.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const fake = vi.hoisted(() => {
  const transfersByKey = new Map<string, Promise<any>>();
  const transfers: any[] = [];
  const refundsByKey = new Map<string, any>();
  const refunds: any[] = [];
  const sessions = new Map<
    string,
    { id: string; status: string; payment_status: string; payment_intent: string | null }
  >();
  let transferDelayMs = 0;
  let failTransfers = false;
  let failPIRetrieve = false;
  let accountOverride: any = null;
  const sessionCreates: any[] = [];

  const stripe = {
    paymentIntents: {
      retrieve: async (id: string) => {
        if (failPIRetrieve) {
          throw Object.assign(new Error("PaymentIntent lookup failed"), { statusCode: 500 });
        }
        return { id, latest_charge: "ch_fake_1" };
      },
    },
    accounts: {
      retrieve: async (id: string) => ({
        id,
        payouts_enabled: true,
        capabilities: { transfers: "active" },
        details_submitted: true,
        ...(accountOverride ?? {}),
      }),
    },
    transfers: {
      create: (params: any, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey ?? `no-key-${transfers.length}-${Math.random()}`;
        // Stripe semantics: a repeated idempotency key returns the original
        // request's result instead of creating a second transfer.
        if (transfersByKey.has(key)) return transfersByKey.get(key)!;
        const p = (async () => {
          await new Promise((r) => setTimeout(r, transferDelayMs));
          if (failTransfers) {
            const err: any = new Error("No such destination account");
            err.statusCode = 400;
            throw err;
          }
          const t = { id: `tr_fake_${transfers.length + 1}`, ...params };
          transfers.push(t);
          return t;
        })();
        transfersByKey.set(key, p);
        p.catch(() => transfersByKey.delete(key)); // a failed attempt doesn't burn the key
        return p;
      },
      list: async ({ transfer_group }: any) => ({
        data: transfers.filter((t) => t.transfer_group === transfer_group),
      }),
    },
    refunds: {
      create: async (params: any, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey ?? `no-key-${refunds.length}`;
        if (refundsByKey.has(key)) return refundsByKey.get(key)!;
        const r = { id: `re_fake_${refunds.length + 1}`, ...params };
        refundsByKey.set(key, r);
        refunds.push(r);
        return r;
      },
    },
    checkout: {
      sessions: {
        create: async (params: any) => {
          sessionCreates.push(params);
          const id = `cs_created_${sessionCreates.length}`;
          const s = {
            id,
            url: "https://checkout.stripe.test/pay",
            status: "open",
            payment_status: "unpaid",
            payment_intent: null,
            metadata: params.metadata ?? {},
          };
          sessions.set(id, s);
          return s;
        },
        expire: async (id: string) => {
          const s = sessions.get(id);
          if (!s) throw Object.assign(new Error("No such session"), { statusCode: 404 });
          if (s.status === "complete") {
            throw Object.assign(new Error("Session is already complete"), { statusCode: 400 });
          }
          s.status = "expired";
          return s;
        },
        retrieve: async (id: string) => {
          const s = sessions.get(id);
          if (!s) throw Object.assign(new Error("No such session"), { statusCode: 404 });
          return s;
        },
      },
    },
  };

  return {
    stripe,
    transfers,
    refunds,
    sessions,
    sessionCreates,
    setTransferDelay: (ms: number) => {
      transferDelayMs = ms;
    },
    setFailTransfers: (v: boolean) => {
      failTransfers = v;
    },
    setFailPIRetrieve: (v: boolean) => {
      failPIRetrieve = v;
    },
    setAccountState: (v: any) => {
      accountOverride = v;
    },
  };
});

vi.mock("../../lib/stripe", () => ({
  stripe: fake.stripe,
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  requireStripe: () => fake.stripe,
  computeApplicationFeeCents: (amount: number) => Math.round(amount * 0.05),
  PLATFORM_COMMISSION_RATE: 0.05,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"] ?? "";
    next();
  },
}));

import { db, freelancers, freelancerJobs } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import freelancerJobsRouter from "../freelancer-jobs";
import { handleCheckoutPaid } from "../webhooks";

const FREELANCER_USER = "user_test_escrow_freelancer";
const HIRER_USER = "user_test_escrow_hirer";

let server: import("node:http").Server;
let base = "";
let freelancerId = "";

async function call(
  path: string,
  opts: { method?: string; user?: string; body?: unknown } = {},
) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", "x-test-user": opts.user ?? FREELANCER_USER },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function seedJob(overrides: Partial<typeof freelancerJobs.$inferInsert> = {}) {
  const [job] = await db
    .insert(freelancerJobs)
    .values({
      freelancerId,
      sellerId: HIRER_USER,
      title: "Escrow test job",
      agreedPriceCents: 10_000,
      platformFeeCents: 500,
      freelancerPayoutCents: 9_500,
      status: "in_progress",
      paymentStatus: "paid",
      stripePaymentIntentId: "pi_fake_1",
      ...overrides,
    })
    .returning();
  return job;
}

beforeAll(async () => {
  // FK: freelancers.user_id → users.clerk_id (email is NOT NULL)
  await db.execute(
    sql`INSERT INTO users (clerk_id, email, name) VALUES (${FREELANCER_USER}, ${`${FREELANCER_USER}@test.local`}, ${"Escrow Test Freelancer"}), (${HIRER_USER}, ${`${HIRER_USER}@test.local`}, ${"Escrow Test Hirer"}) ON CONFLICT (clerk_id) DO NOTHING`,
  );
  const [f] = await db
    .insert(freelancers)
    .values({
      userId: FREELANCER_USER,
      serviceType: "graphic_design",
      hourlyRateCents: 5_000,
      stripeAccountId: "acct_fake_1",
      stripeAccountStatus: "active",
    })
    .onConflictDoUpdate({
      target: freelancers.userId,
      set: { stripeAccountId: "acct_fake_1", isActive: true },
    })
    .returning();
  freelancerId = f.id;

  const app = express();
  app.use(express.json());
  app.use("/api/freelancer-jobs", freelancerJobsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  if (freelancerId) {
    await db.delete(freelancerJobs).where(eq(freelancerJobs.freelancerId, freelancerId));
    await db.delete(freelancers).where(eq(freelancers.id, freelancerId));
  }
  await db.execute(sql`DELETE FROM users WHERE clerk_id IN (${FREELANCER_USER}, ${HIRER_USER})`);
});

describe("job completion payout", () => {
  it("A: two concurrent complete calls produce exactly one transfer", async () => {
    const job = await seedJob();
    fake.setTransferDelay(40);
    const [r1, r2] = await Promise.all([
      call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" }),
      call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" }),
    ]);
    fake.setTransferDelay(0);

    const created = fake.transfers.filter(
      (t) => t.transfer_group === `freelancer_job_${job.id}`,
    );
    expect(created).toHaveLength(1);
    for (const r of [r1, r2]) expect([200, 409]).toContain(r.status);
    expect([r1, r2].filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.status).toBe("completed");
    expect(row.stripeTransferId).toBe(created[0].id);
  });

  it("B: crash between claim and transfer persistence is reconciled without a second transfer", async () => {
    // Simulate: the status flip won, but the process died before the payout
    // transfer was created/persisted.
    const job = await seedJob({ status: "completed", completedAt: new Date() });
    const r1 = await call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" });
    expect(r1.status).toBe(200);
    const created = fake.transfers.filter(
      (t) => t.transfer_group === `freelancer_job_${job.id}`,
    );
    expect(created).toHaveLength(1);

    // Completing again is an idempotent success, not a second payout.
    const r2 = await call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" });
    expect(r2.status).toBe(200);
    expect(
      fake.transfers.filter((t) => t.transfer_group === `freelancer_job_${job.id}`),
    ).toHaveLength(1);
    expect(r2.body.payout.transferId).toBe(created[0].id);
  });

  it("failed transfer rolls the claim back so completion can be retried", async () => {
    const job = await seedJob();
    fake.setFailTransfers(true);
    const r1 = await call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" });
    fake.setFailTransfers(false);
    expect(r1.status).toBeGreaterThanOrEqual(400);

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.status).toBe("in_progress"); // retryable, not stuck
    expect(row.stripeTransferId).toBeNull();

    const r2 = await call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" });
    expect(r2.status).toBe(200);
  });
});

describe("cancellation vs late checkout payment", () => {
  it("C1: cancelling an unpaid job expires the checkout session", async () => {
    fake.sessions.set("cs_open_1", {
      id: "cs_open_1",
      status: "open",
      payment_status: "unpaid",
      payment_intent: null,
    });
    const job = await seedJob({
      status: "pending",
      paymentStatus: "unpaid",
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: "cs_open_1",
    });
    const r = await call(`/api/freelancer-jobs/${job.id}/cancel`, {
      method: "PATCH",
      user: HIRER_USER,
    });
    expect(r.status).toBe(200);
    expect(fake.sessions.get("cs_open_1")!.status).toBe("expired");

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.status).toBe("cancelled");
    expect(row.paymentStatus).toBe("unpaid");
  });

  it("C2: payment that lands during cancellation is refunded, not kept", async () => {
    // The buyer completed checkout right before cancel ran → expire throws.
    fake.sessions.set("cs_paid_1", {
      id: "cs_paid_1",
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_late_1",
    });
    const job = await seedJob({
      status: "pending",
      paymentStatus: "unpaid",
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: "cs_paid_1",
    });
    const r = await call(`/api/freelancer-jobs/${job.id}/cancel`, {
      method: "PATCH",
      user: HIRER_USER,
    });
    expect(r.status).toBe(200);

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.status).toBe("cancelled");
    expect(row.paymentStatus).toBe("refunded");
    expect(fake.refunds.some((x) => x.payment_intent === "pi_late_1")).toBe(true);
  });

  it("C3: sync-payment after cancellation refunds instead of marking paid", async () => {
    // Cancel happened while the session was open; the buyer pays afterwards
    // through the stale link (covers webhook lag / expire race).
    const job = await seedJob({
      status: "cancelled",
      paymentStatus: "unpaid",
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: "cs_late_1",
    });
    fake.sessions.set("cs_late_1", {
      id: "cs_late_1",
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_late_2",
    });

    const r = await call(`/api/freelancer-jobs/${job.id}/sync-payment`, {
      method: "POST",
      user: HIRER_USER,
    });
    expect(r.status).toBe(200);
    expect(r.body.paymentStatus).toBe("refunded");

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.paymentStatus).toBe("refunded");
    expect(row.status).toBe("cancelled");
    expect(fake.refunds.some((x) => x.payment_intent === "pi_late_2")).toBe(true);

    // Repeated sync stays refunded and does not refund twice.
    const refundCount = fake.refunds.length;
    const r2 = await call(`/api/freelancer-jobs/${job.id}/sync-payment`, {
      method: "POST",
      user: HIRER_USER,
    });
    expect(r2.body.paymentStatus).toBe("refunded");
    expect(fake.refunds.length).toBe(refundCount);
  });
});

describe("stripe webhook payment confirmation (webhook-only, no sync fallback)", () => {
  it("D1: job creation puts the job id in BOTH session metadata and PI metadata", async () => {
    const r = await call("/api/freelancer-jobs", {
      method: "POST",
      user: HIRER_USER,
      body: { freelancerId, title: "Webhook contract job", agreedPriceCents: 20_000 },
    });
    expect(r.status).toBe(201);
    const created = fake.sessionCreates.at(-1);
    // The webhook dispatches on Checkout Session metadata — Stripe only echoes
    // back what is set top-level here, so this contract is load-bearing.
    expect(created.metadata.freelancerJobId).toBe(r.body.job.id);
    expect(created.metadata.kind).toBe("freelancer_job");
    expect(created.payment_intent_data.metadata.freelancerJobId).toBe(r.body.job.id);
    expect(created.payment_intent_data.transfer_group).toBe(`freelancer_job_${r.body.job.id}`);

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, r.body.job.id));
    expect(row.stripeCheckoutSessionId).toBe(r.body.sessionId);
  });

  it("D2: handleCheckoutPaid with Stripe's real session shape marks the job paid", async () => {
    const create = await call("/api/freelancer-jobs", {
      method: "POST",
      user: HIRER_USER,
      body: { freelancerId, title: "Webhook paid job", agreedPriceCents: 15_000 },
    });
    expect(create.status).toBe(201);
    const jobId = create.body.job.id;

    // Exactly what checkout.session.completed delivers: top-level metadata
    // echoed from creation, payment_intent as a string id.
    await handleCheckoutPaid({
      id: create.body.sessionId,
      client_reference_id: HIRER_USER,
      payment_intent: "pi_webhook_1",
      payment_status: "paid",
      metadata: { freelancerJobId: jobId, kind: "freelancer_job" },
    });

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, jobId));
    expect(row.paymentStatus).toBe("paid");
    expect(row.stripePaymentIntentId).toBe("pi_webhook_1");
  });

  it("D2b: dispatch falls back to the persisted session id when metadata is missing", async () => {
    const job = await seedJob({
      status: "pending",
      paymentStatus: "unpaid",
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: "cs_nometa_1",
    });
    await handleCheckoutPaid({
      id: "cs_nometa_1",
      client_reference_id: HIRER_USER,
      payment_intent: "pi_webhook_2",
      payment_status: "paid",
      metadata: {},
    });
    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.paymentStatus).toBe("paid");
    expect(row.stripePaymentIntentId).toBe("pi_webhook_2");
  });

  it("D3: webhook for a cancelled job refunds instead of marking paid", async () => {
    const job = await seedJob({
      status: "cancelled",
      paymentStatus: "unpaid",
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: "cs_cancelled_wh",
    });
    await handleCheckoutPaid({
      id: "cs_cancelled_wh",
      client_reference_id: HIRER_USER,
      payment_intent: "pi_webhook_3",
      payment_status: "paid",
      metadata: { freelancerJobId: job.id, kind: "freelancer_job" },
    });
    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.status).toBe("cancelled");
    expect(row.paymentStatus).toBe("refunded");
    expect(fake.refunds.some((x) => x.payment_intent === "pi_webhook_3")).toBe(true);
  });
});

describe("connect payout readiness and source-charge integrity", () => {
  it("E1: hiring is blocked when the freelancer's account isn't payout-ready", async () => {
    fake.setAccountState({ payouts_enabled: false, capabilities: { transfers: "inactive" } });
    const sessionsBefore = fake.sessionCreates.length;
    const r = await call("/api/freelancer-jobs", {
      method: "POST",
      user: HIRER_USER,
      body: { freelancerId, title: "Should be blocked", agreedPriceCents: 10_000 },
    });
    fake.setAccountState(null); // back to payout-ready default
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("FREELANCER_NOT_PAYABLE");
    // blocked before Stripe: no checkout session was created
    expect(fake.sessionCreates.length).toBe(sessionsBefore);
    // restore cached status flipped by the live check
    await db
      .update(freelancers)
      .set({ stripeAccountStatus: "active" })
      .where(eq(freelancers.id, freelancerId));
  });

  it("E2: completion fails safely and stays retryable when the escrow charge can't be verified", async () => {
    const job = await seedJob();
    fake.setFailPIRetrieve(true);
    const r1 = await call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" });
    fake.setFailPIRetrieve(false);
    expect(r1.status).toBe(409);
    expect(r1.body.code).toBe("SOURCE_CHARGE_UNAVAILABLE");

    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.status).toBe("in_progress"); // rolled back, retryable
    expect(row.stripeTransferId).toBeNull();
    expect(fake.transfers.filter((t) => t.transfer_group === `freelancer_job_${job.id}`)).toHaveLength(0);

    // retry once Stripe is reachable → exactly one transfer, tied to the charge
    const r2 = await call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" });
    expect(r2.status).toBe(200);
    const created = fake.transfers.filter((t) => t.transfer_group === `freelancer_job_${job.id}`);
    expect(created).toHaveLength(1);
    expect(created[0].source_transaction).toBe("ch_fake_1");
  });

  it("E3: a paid in-progress job can be cancelled for a refund before payout (recovery path)", async () => {
    const job = await seedJob(); // in_progress + paid
    const r = await call(`/api/freelancer-jobs/${job.id}/cancel`, { method: "PATCH", user: HIRER_USER });
    expect(r.status).toBe(200);
    const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, job.id));
    expect(row.status).toBe("cancelled");
    expect(row.paymentStatus).toBe("refunded");
    // completion is now impossible — funds went back to the hirer
    const rc = await call(`/api/freelancer-jobs/${job.id}/complete`, { method: "PATCH" });
    expect(rc.status).toBe(409);
    expect(fake.transfers.filter((t) => t.transfer_group === `freelancer_job_${job.id}`)).toHaveLength(0);
  });
});
