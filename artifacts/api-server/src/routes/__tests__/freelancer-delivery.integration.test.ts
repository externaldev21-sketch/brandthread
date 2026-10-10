/**
 * BT-446 — freelancer delivery + hirer approval lifecycle.
 *
 *  deliver (no money) → approve (single transfer) | request revision (capped)
 *  | report a problem (disputed: release frozen) | auto-release after N days.
 *  A freelancer can never trigger their own payout.
 *
 * Runs against the test Postgres with Stripe replaced by an in-memory fake
 * that honors idempotency keys; notifications are captured, not sent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const fake = vi.hoisted(() => {
  const transfersByKey = new Map<string, Promise<any>>();
  const transfers: any[] = [];
  const transferKeys: string[] = [];
  const refunds: any[] = [];
  const refundsByKey = new Map<string, any>();
  const stripe = {
    paymentIntents: { retrieve: async (id: string) => ({ id, latest_charge: "ch_fake_dl" }) },
    accounts: {
      retrieve: async (id: string) => ({ id, payouts_enabled: true, capabilities: { transfers: "active" }, details_submitted: true }),
    },
    transfers: {
      create: (params: any, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey ?? `no-key-${Math.random()}`;
        if (transfersByKey.has(key)) return transfersByKey.get(key)!;
        const p = (async () => {
          const t = { id: `tr_dl_${transfers.length + 1}`, ...params };
          transfers.push(t);
          transferKeys.push(key);
          return t;
        })();
        transfersByKey.set(key, p);
        return p;
      },
      list: async ({ transfer_group }: any) => ({ data: transfers.filter((t) => t.transfer_group === transfer_group) }),
    },
    refunds: {
      create: async (params: any, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey ?? `no-key-${refunds.length}`;
        if (refundsByKey.has(key)) return refundsByKey.get(key)!;
        const r = { id: `re_dl_${refunds.length + 1}`, ...params };
        refundsByKey.set(key, r);
        refunds.push(r);
        return r;
      },
    },
    checkout: { sessions: { create: async () => ({}), expire: async () => ({}), retrieve: async () => ({}) } },
  };
  return { stripe, transfers, transferKeys, refunds };
});

const notifications = vi.hoisted(() => [] as any[]);

vi.mock("../../lib/stripe", () => ({
  stripe: fake.stripe,
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  requireStripe: () => fake.stripe,
  computeApplicationFeeCents: (amount: number) => Math.round(amount * 0.05),
  PLATFORM_COMMISSION_RATE: 0.05,
}));

vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: any) => {
    notifications.push(n);
  },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"] ?? "";
    next();
  },
}));

import { db, freelancers, freelancerJobs, pool } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import freelancerJobsRouter from "../freelancer-jobs";
import { runFreelancerAutoRelease, FREELANCER_AUTO_RELEASE_LOCK } from "../../jobs/freelancerAutoRelease";
import {
  autoReleaseDays,
  FREELANCER_REVISION_CAP,
  listOpenFreelancerJobDisputes,
  releaseJobPayout,
} from "../../lib/freelancerRelease";

const FREELANCER = "user_test_delivery_freelancer";
const HIRER = "user_test_delivery_hirer";
const STRANGER = "user_test_delivery_stranger";
const DAY = 24 * 60 * 60 * 1000;

let server: import("node:http").Server;
let base = "";
let freelancerId = "";

async function call(path: string, opts: { method?: string; user: string; body?: unknown }) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "PATCH",
    headers: { "content-type": "application/json", "x-test-user": opts.user },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function seedJob(overrides: Partial<typeof freelancerJobs.$inferInsert> = {}) {
  const [job] = await db
    .insert(freelancerJobs)
    .values({
      freelancerId,
      sellerId: HIRER,
      title: "Delivery test job",
      agreedPriceCents: 10_000,
      platformFeeCents: 500,
      freelancerPayoutCents: 9_500,
      status: "in_progress",
      paymentStatus: "paid",
      stripePaymentIntentId: "pi_fake_dl",
      ...overrides,
    })
    .returning();
  return job;
}

async function load(id: string) {
  const [row] = await db.select().from(freelancerJobs).where(eq(freelancerJobs.id, id));
  return row;
}

const transfersFor = (id: string) => fake.transfers.filter((t) => t.transfer_group === `freelancer_job_${id}`);

/** Only this suite's jobs, so the sweep never touches anything else. */
async function clearJobs() {
  await db.delete(freelancerJobs).where(eq(freelancerJobs.freelancerId, freelancerId));
}

beforeAll(async () => {
  await db.execute(
    sql`INSERT INTO users (clerk_id, email, name) VALUES
      (${FREELANCER}, ${`${FREELANCER}@test.local`}, ${"Dana Freelancer"}),
      (${HIRER}, ${`${HIRER}@test.local`}, ${"Hal Hirer"}),
      (${STRANGER}, ${`${STRANGER}@test.local`}, ${"Sam Stranger"})
      ON CONFLICT (clerk_id) DO NOTHING`,
  );
  const [f] = await db
    .insert(freelancers)
    .values({
      userId: FREELANCER,
      serviceType: "graphic_design",
      hourlyRateCents: 5_000,
      stripeAccountId: "acct_fake_dl",
      stripeAccountStatus: "active",
    })
    .onConflictDoUpdate({ target: freelancers.userId, set: { stripeAccountId: "acct_fake_dl", isActive: true } })
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
    await clearJobs();
    await db.delete(freelancers).where(eq(freelancers.id, freelancerId));
  }
  await db.execute(sql`DELETE FROM users WHERE clerk_id IN (${FREELANCER}, ${HIRER}, ${STRANGER})`);
});

beforeEach(async () => {
  notifications.length = 0;
  await clearJobs();
});

describe("deliver", () => {
  it("freelancer delivers: status delivered, note saved, auto-release clock set, no transfer, hirer notified", async () => {
    const job = await seedJob();
    const before = Date.now();
    const r = await call(`/api/freelancer-jobs/${job.id}/deliver`, { user: FREELANCER, body: { note: "Final logo files are in our shared folder." } });
    expect(r.status).toBe(200);
    expect(r.body.job.status).toBe("delivered");
    expect(r.body.job.deliveryNote).toBe("Final logo files are in our shared folder.");

    const row = await load(job.id);
    expect(row.status).toBe("delivered");
    expect(row.deliveredAt).not.toBeNull();
    const expected = before + autoReleaseDays() * DAY;
    expect(Math.abs(row.autoReleaseAt!.getTime() - expected)).toBeLessThan(60_000);
    expect(row.stripeTransferId).toBeNull();
    expect(transfersFor(job.id)).toHaveLength(0);

    expect(notifications.some((n) => n.userId === HIRER && n.type === "freelancer_job_delivered" && n.targetId === job.id)).toBe(true);
  });

  it("legacy PATCH /complete from the freelancer means deliver — never a payout", async () => {
    const job = await seedJob();
    const r = await call(`/api/freelancer-jobs/${job.id}/complete`, { user: FREELANCER });
    expect(r.status).toBe(200);
    expect(r.body.delivered).toBe(true);
    expect(r.body.payout.transferId).toBeNull();
    expect((await load(job.id)).status).toBe("delivered");

    // Calling it again (old client retry) is idempotent and still pays nothing.
    const r2 = await call(`/api/freelancer-jobs/${job.id}/complete`, { user: FREELANCER });
    expect(r2.status).toBe(200);
    expect((await load(job.id)).status).toBe("delivered");
    expect(transfersFor(job.id)).toHaveLength(0);
  });

  it("can't deliver an unpaid or not-started job", async () => {
    const unpaid = await seedJob({ paymentStatus: "unpaid" });
    expect((await call(`/api/freelancer-jobs/${unpaid.id}/deliver`, { user: FREELANCER })).status).toBe(409);
    const accepted = await seedJob({ status: "accepted" });
    expect((await call(`/api/freelancer-jobs/${accepted.id}/deliver`, { user: FREELANCER })).status).toBe(409);
  });
});

describe("approve", () => {
  it("hirer approval completes the job and creates exactly one transfer with the job's idempotency key", async () => {
    const job = await seedJob({ status: "delivered", deliveredAt: new Date(), autoReleaseAt: new Date(Date.now() + 3 * DAY) });
    const r = await call(`/api/freelancer-jobs/${job.id}/approve`, { user: HIRER });
    expect(r.status).toBe(200);
    expect(r.body.payout.amountCents).toBe(9_500);

    const row = await load(job.id);
    expect(row.status).toBe("completed");
    expect(row.approvedBy).toBe("hirer");
    expect(row.autoReleaseAt).toBeNull();
    const created = transfersFor(job.id);
    expect(created).toHaveLength(1);
    expect(created[0].amount).toBe(9_500);
    expect(created[0].destination).toBe("acct_fake_dl");
    expect(created[0].source_transaction).toBe("ch_fake_dl");
    expect(fake.transferKeys[fake.transfers.indexOf(created[0])]).toBe(`freelancer-job-payout-${job.id}`);
    expect(row.stripeTransferId).toBe(created[0].id);

    // Approving again is idempotent.
    const r2 = await call(`/api/freelancer-jobs/${job.id}/approve`, { user: HIRER });
    expect(r2.status).toBe(200);
    expect(transfersFor(job.id)).toHaveLength(1);
    expect(notifications.some((n) => n.userId === FREELANCER && n.type === "freelancer_job_approved")).toBe(true);
  });

  it("legacy PATCH /complete from the hirer means approve", async () => {
    const job = await seedJob({ status: "delivered", deliveredAt: new Date() });
    const r = await call(`/api/freelancer-jobs/${job.id}/complete`, { user: HIRER });
    expect(r.status).toBe(200);
    expect((await load(job.id)).status).toBe("completed");
    expect(transfersFor(job.id)).toHaveLength(1);
  });

  it("nothing to approve before delivery", async () => {
    const job = await seedJob();
    const r = await call(`/api/freelancer-jobs/${job.id}/approve`, { user: HIRER });
    expect(r.status).toBe(409);
    expect((await load(job.id)).status).toBe("in_progress");
    expect(transfersFor(job.id)).toHaveLength(0);
  });
});

describe("freelancer can never self-pay", () => {
  it("freelancer can't approve their own delivery, and deliver → complete → complete never pays", async () => {
    const job = await seedJob();
    expect((await call(`/api/freelancer-jobs/${job.id}/deliver`, { user: FREELANCER })).status).toBe(200);
    const a = await call(`/api/freelancer-jobs/${job.id}/approve`, { user: FREELANCER });
    expect(a.status).toBe(403);
    await call(`/api/freelancer-jobs/${job.id}/complete`, { user: FREELANCER });
    await call(`/api/freelancer-jobs/${job.id}/complete`, { user: FREELANCER });
    const row = await load(job.id);
    expect(row.status).toBe("delivered");
    expect(row.stripeTransferId).toBeNull();
    expect(transfersFor(job.id)).toHaveLength(0);
  });

  it("a crashed release (completed, no transfer) is not retried by the freelancer", async () => {
    const job = await seedJob({ status: "completed", completedAt: new Date() });
    const r = await call(`/api/freelancer-jobs/${job.id}/complete`, { user: FREELANCER });
    expect(r.status).toBe(200);
    expect(transfersFor(job.id)).toHaveLength(0);
  });
});

describe("request revision", () => {
  it("sends the delivery back with a note, stops the auto-release clock, and caps at the limit", async () => {
    const job = await seedJob({ status: "delivered", deliveredAt: new Date(), autoReleaseAt: new Date(Date.now() + DAY) });

    const empty = await call(`/api/freelancer-jobs/${job.id}/request-revision`, { user: HIRER, body: {} });
    expect(empty.status).toBe(400);

    for (let i = 1; i <= FREELANCER_REVISION_CAP; i++) {
      const r = await call(`/api/freelancer-jobs/${job.id}/request-revision`, { user: HIRER, body: { note: `Change ${i}` } });
      expect(r.status).toBe(200);
      expect(r.body.job.status).toBe("in_progress");
      expect(r.body.job.revisionCount).toBe(i);
      expect(r.body.job.revisionsLeft).toBe(FREELANCER_REVISION_CAP - i);
      const row = await load(job.id);
      expect(row.revisionNote).toBe(`Change ${i}`);
      expect(row.autoReleaseAt).toBeNull();
      expect(notifications.some((n) => n.userId === FREELANCER && n.type === "freelancer_job_revision")).toBe(true);
      // freelancer re-delivers
      expect((await call(`/api/freelancer-jobs/${job.id}/deliver`, { user: FREELANCER })).status).toBe(200);
    }

    const over = await call(`/api/freelancer-jobs/${job.id}/request-revision`, { user: HIRER, body: { note: "One more" } });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe("REVISION_LIMIT");
    expect((await load(job.id)).status).toBe("delivered");
    expect(transfersFor(job.id)).toHaveLength(0);
  });

  it("only a delivered job can be sent back", async () => {
    const job = await seedJob();
    const r = await call(`/api/freelancer-jobs/${job.id}/request-revision`, { user: HIRER, body: { note: "x" } });
    expect(r.status).toBe(409);
  });
});

describe("dispute", () => {
  it("freezes release: no approval, no auto-release, no cancel; freelancer notified; listed for admin", async () => {
    const job = await seedJob({ status: "delivered", deliveredAt: new Date(), autoReleaseAt: new Date(Date.now() + DAY) });

    expect((await call(`/api/freelancer-jobs/${job.id}/dispute`, { user: HIRER, body: {} })).status).toBe(400);
    const r = await call(`/api/freelancer-jobs/${job.id}/dispute`, { user: HIRER, body: { reason: "Files never arrived" } });
    expect(r.status).toBe(200);
    expect(r.body.job.status).toBe("disputed");

    const row = await load(job.id);
    expect(row.disputeOpenedBy).toBe("hirer");
    expect(row.disputeReason).toBe("Files never arrived");
    expect(row.autoReleaseAt).toBeNull();
    expect(notifications.some((n) => n.userId === FREELANCER && n.type === "freelancer_job_disputed")).toBe(true);

    const a = await call(`/api/freelancer-jobs/${job.id}/approve`, { user: HIRER });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe("JOB_DISPUTED");

    // Even with a past-due release clock (e.g. set by another path), the sweep skips it.
    await db.update(freelancerJobs).set({ autoReleaseAt: new Date(Date.now() - DAY) }).where(eq(freelancerJobs.id, job.id));
    await runFreelancerAutoRelease(new Date(), { stripe: fake.stripe });
    expect((await load(job.id)).status).toBe("disputed");

    expect((await call(`/api/freelancer-jobs/${job.id}/cancel`, { user: HIRER })).status).toBe(409);
    expect((await call(`/api/freelancer-jobs/${job.id}/cancel`, { user: FREELANCER })).status).toBe(409);
    expect((await call(`/api/freelancer-jobs/${job.id}/complete`, { user: FREELANCER })).status).toBe(409);
    expect(transfersFor(job.id)).toHaveLength(0);

    const open = await listOpenFreelancerJobDisputes();
    expect(open.some((d) => d.jobId === job.id && d.disputeOpenedBy === "hirer")).toBe(true);

    // The admin resolution hook can release a disputed job explicitly.
    const res = await releaseJobPayout(fake.stripe as any, job.id, { trigger: "admin", from: ["disputed"] });
    expect(res.claimedNow).toBe(true);
    expect(transfersFor(job.id)).toHaveLength(1);
    expect((await load(job.id)).approvedBy).toBe("admin");
  });

  it("a chargeback-opened dispute (set by the webhook handler) is frozen the same way", async () => {
    const job = await seedJob({ status: "disputed", deliveredAt: new Date(), disputedAt: new Date(), disputeOpenedBy: "chargeback" });
    expect((await call(`/api/freelancer-jobs/${job.id}/approve`, { user: HIRER })).status).toBe(409);
    await runFreelancerAutoRelease(new Date(), { stripe: fake.stripe });
    expect(transfersFor(job.id)).toHaveLength(0);
  });
});

describe("auto-release job", () => {
  it("reminds the hirer once a day before, then approves and pays exactly once", async () => {
    const now = new Date();
    const job = await seedJob({ status: "delivered", deliveredAt: new Date(now.getTime() - 2.5 * DAY), autoReleaseAt: new Date(now.getTime() + 12 * 60 * 60 * 1000) });

    const s1 = await runFreelancerAutoRelease(now, { stripe: fake.stripe });
    expect(s1.reminded).toBe(1);
    expect(s1.released).toBe(0);
    const s1b = await runFreelancerAutoRelease(now, { stripe: fake.stripe });
    expect(s1b.reminded).toBe(0); // only once
    expect(notifications.filter((n) => n.type === "freelancer_job_auto_release_reminder" && n.userId === HIRER)).toHaveLength(1);

    const later = new Date(now.getTime() + DAY);
    const s2 = await runFreelancerAutoRelease(later, { stripe: fake.stripe });
    expect(s2.released).toBe(1);
    const row = await load(job.id);
    expect(row.status).toBe("completed");
    expect(row.approvedBy).toBe("auto");
    expect(transfersFor(job.id)).toHaveLength(1);
    expect(notifications.some((n) => n.userId === FREELANCER && n.type === "freelancer_job_approved")).toBe(true);
    expect(notifications.some((n) => n.userId === HIRER && n.type === "freelancer_job_auto_completed")).toBe(true);

    const s3 = await runFreelancerAutoRelease(later, { stripe: fake.stripe });
    expect(s3.released).toBe(0);
    expect(transfersFor(job.id)).toHaveLength(1);
  });

  it("leaves deliveries inside the review window alone", async () => {
    const job = await seedJob({ status: "delivered", deliveredAt: new Date(), autoReleaseAt: new Date(Date.now() + 3 * DAY) });
    const s = await runFreelancerAutoRelease(new Date(), { stripe: fake.stripe });
    expect(s.released).toBe(0);
    expect(s.reminded).toBe(0);
    expect((await load(job.id)).status).toBe("delivered");
  });

  it("retries a payout a crash left unsent", async () => {
    const job = await seedJob({ status: "completed", completedAt: new Date(Date.now() - 60 * 60 * 1000), approvedBy: "hirer" });
    const s = await runFreelancerAutoRelease(new Date(), { stripe: fake.stripe });
    expect(s.retried).toBe(1);
    expect(transfersFor(job.id)).toHaveLength(1);
    expect((await load(job.id)).stripeTransferId).toBe(transfersFor(job.id)[0].id);
  });

  it("skips the run while another server holds the advisory lock", async () => {
    const job = await seedJob({ status: "delivered", deliveredAt: new Date(), autoReleaseAt: new Date(Date.now() - DAY) });
    const other = await pool.connect();
    try {
      await other.query("SELECT pg_advisory_lock(hashtext($1))", [FREELANCER_AUTO_RELEASE_LOCK]);
      const s = await runFreelancerAutoRelease(new Date(), { stripe: fake.stripe });
      expect(s.skipped).toBe("locked");
      expect((await load(job.id)).status).toBe("delivered");
    } finally {
      await other.query("SELECT pg_advisory_unlock(hashtext($1))", [FREELANCER_AUTO_RELEASE_LOCK]);
      other.release();
    }
  });

  it("FREELANCER_AUTO_RELEASE_DAYS overrides the default of 3", () => {
    expect(autoReleaseDays({} as any)).toBe(3);
    expect(autoReleaseDays({ FREELANCER_AUTO_RELEASE_DAYS: "5" } as any)).toBe(5);
    expect(autoReleaseDays({ FREELANCER_AUTO_RELEASE_DAYS: "abc" } as any)).toBe(3);
    expect(autoReleaseDays({ FREELANCER_AUTO_RELEASE_DAYS: "0" } as any)).toBe(3);
  });
});

describe("permissions and cancellation", () => {
  it("only the right party can take each action", async () => {
    const job = await seedJob();
    expect((await call(`/api/freelancer-jobs/${job.id}/deliver`, { user: HIRER })).status).toBe(403);
    expect((await call(`/api/freelancer-jobs/${job.id}/deliver`, { user: STRANGER })).status).toBe(403);
    await call(`/api/freelancer-jobs/${job.id}/deliver`, { user: FREELANCER });

    expect((await call(`/api/freelancer-jobs/${job.id}/approve`, { user: STRANGER })).status).toBe(403);
    expect((await call(`/api/freelancer-jobs/${job.id}/complete`, { user: STRANGER })).status).toBe(403);
    expect((await call(`/api/freelancer-jobs/${job.id}/request-revision`, { user: FREELANCER, body: { note: "x" } })).status).toBe(403);
    expect((await call(`/api/freelancer-jobs/${job.id}/request-revision`, { user: STRANGER, body: { note: "x" } })).status).toBe(403);
    expect((await call(`/api/freelancer-jobs/${job.id}/dispute`, { user: FREELANCER, body: { reason: "x" } })).status).toBe(403);
    expect((await call(`/api/freelancer-jobs/${job.id}/dispute`, { user: STRANGER, body: { reason: "x" } })).status).toBe(403);
    expect((await call(`/api/freelancer-jobs/${job.id}`, { method: "GET", user: STRANGER })).status).toBe(403);
    expect(transfersFor(job.id)).toHaveLength(0);
  });

  it("the hirer can't cancel for a refund once work is delivered; the freelancer can", async () => {
    const job = await seedJob({ status: "delivered", deliveredAt: new Date() });
    const h = await call(`/api/freelancer-jobs/${job.id}/cancel`, { user: HIRER });
    expect(h.status).toBe(409);
    expect(h.body.code).toBe("JOB_DELIVERED");

    // also after a revision (in_progress with a prior delivery)
    const rev = await seedJob({ status: "in_progress", deliveredAt: new Date(), revisionCount: 1 });
    expect((await call(`/api/freelancer-jobs/${rev.id}/cancel`, { user: HIRER })).status).toBe(409);

    const f = await call(`/api/freelancer-jobs/${job.id}/cancel`, { user: FREELANCER });
    expect(f.status).toBe(200);
    const row = await load(job.id);
    expect(row.status).toBe("cancelled");
    expect(row.paymentStatus).toBe("refunded");
    expect(transfersFor(job.id)).toHaveLength(0);
  });

  it("the hirer can still cancel an in-progress job that has no delivery yet", async () => {
    const job = await seedJob();
    expect((await call(`/api/freelancer-jobs/${job.id}/cancel`, { user: HIRER })).status).toBe(200);
  });
});
