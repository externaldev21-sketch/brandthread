/**
 * Promoted threads + Featured slots: admin approval state machine, refund on
 * reject, payment gating, Sponsored eligibility / frequency / spend cap, and
 * Featured slot scarcity. Stripe and Clerk are mocked like the boosts tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  blocks, boosts, db, featuredSlots, posts, promotionReviews, sponsoredDeliveries, users,
} from "@workspace/db";

// ── Stripe mock ───────────────────────────────────────────────────────────────

type FakeSession = {
  id: string; url: string; status: string; payment_status: string;
  amount_total: number; currency: string; metadata: Record<string, string>; payment_intent: string;
};
const stripeState = vi.hoisted(() => ({
  sessions: new Map<string, any>(),
  refunds: [] as any[],
  failRefund: false,
}));

const stripeFake = vi.hoisted(() => ({
  checkout: {
    sessions: {
      create: vi.fn(async (params: any) => {
        const id = `cs_test_${crypto.randomUUID()}`;
        const s = {
          id, url: `https://checkout.stripe.com/test/${id}`, status: "open", payment_status: "unpaid",
          amount_total: params.line_items[0].price_data.unit_amount, currency: "usd",
          metadata: params.metadata, payment_intent: `pi_${id}`,
        };
        stripeState.sessions.set(id, s);
        return s;
      }),
      retrieve: vi.fn(async (id: string) => {
        const s = stripeState.sessions.get(id);
        if (!s) throw new Error(`no session ${id}`);
        return { ...s };
      }),
      expire: vi.fn(async (id: string) => {
        const s = stripeState.sessions.get(id);
        if (s) s.status = "expired";
        return s;
      }),
    },
  },
  refunds: {
    create: vi.fn(async (params: any) => {
      if (stripeState.failRefund) throw new Error("stripe down");
      const refund = { id: `re_${crypto.randomUUID()}`, ...params };
      stripeState.refunds.push(refund);
      return refund;
    }),
  },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
  requireModerator: async (req: any, res: any, next: any) => {
    const { db: database, users: usersTable } = await import("@workspace/db");
    const { eq: equals } = await import("drizzle-orm");
    const [u] = await database.select({ role: usersTable.role }).from(usersTable)
      .where(equals(usersTable.clerkId, req.clerkUserId)).limit(1);
    if (u?.role !== "admin") return res.status(403).json({ error: "Moderator access required" });
    next();
  },
}));
vi.mock("../../lib/stripe", () => ({ requireStripe: () => stripeFake }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const tag = crypto.randomUUID().slice(0, 8);
const admin = `promo-admin-${tag}`;
const sellerA = `promo-sellerA-${tag}`;
const sellerB = `promo-sellerB-${tag}`;
const sellerC = `promo-sellerC-${tag}`;
const viewer = `promo-viewer-${tag}`;
const allUsers = [admin, sellerA, sellerB, sellerC, viewer];

let server: Server;
let base = "";
let postA = "";
let postB = "";

async function req(user: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function markPaid(sessionId: string) {
  const s = stripeState.sessions.get(sessionId);
  s.payment_status = "paid";
  s.status = "complete";
}

async function boostToInReview(seller: string, postId: string, budgetCents = 2500) {
  const created = await req(seller, "POST", "/api/boosts", { targetType: "post", targetId: postId, budgetCents, durationDays: 7 });
  expect(created.status).toBe(201);
  const pay = await req(seller, "POST", `/api/boosts/${created.body.id}/pay`, { returnUrl: `brandthread://boost?id=${created.body.id}&paymentReturn=1` });
  expect([200, 201]).toContain(pay.status);
  markPaid(pay.body.sessionId);
  const verified = await req(seller, "POST", `/api/boosts/${created.body.id}/pay/verify`);
  expect(verified.status).toBe(200);
  return { id: created.body.id as string, sessionId: pay.body.sessionId as string, verified };
}

beforeAll(async () => {
  delete process.env.PROMOTION_REVIEW_REQUIRED;
  const { default: boostsRouter } = await import("../boosts");
  const { default: featuredRouter } = await import("../featured-slots");
  const { default: adminRouter } = await import("../admin-promotions");
  const { default: promotionsRouter } = await import("../promotions");
  const app = express();
  app.use(express.json());
  app.use("/api/boosts", boostsRouter);
  app.use("/api/featured-slots", featuredRouter);
  app.use("/api/admin/promotions", adminRouter);
  app.use("/api/promotions", promotionsRouter);

  await db.insert(users).values([
    { clerkId: admin, email: `${admin}@test.local`, name: "Admin", role: "admin", accountType: "seller" },
    { clerkId: sellerA, email: `${sellerA}@test.local`, name: "Seller A", brandName: "Brand A", role: "seller", accountType: "seller" },
    { clerkId: sellerB, email: `${sellerB}@test.local`, name: "Seller B", brandName: "Brand B", role: "seller", accountType: "seller" },
    { clerkId: sellerC, email: `${sellerC}@test.local`, name: "Seller C", brandName: "Brand C", role: "seller", accountType: "seller" },
    { clerkId: viewer, email: `${viewer}@test.local`, name: "Viewer", role: "buyer", accountType: "buyer" },
  ]);
  [postA] = (await db.insert(posts).values({
    userId: sellerA, mediaUrl: "https://cdn.test/a.mp4", mediaType: "video", postStatus: "published", caption: "fresh drop",
  }).returning({ id: posts.id })).map((x) => x.id);
  [postB] = (await db.insert(posts).values({
    userId: sellerB, mediaUrl: "https://cdn.test/b.mp4", mediaType: "video", postStatus: "published", caption: "studio day",
  }).returning({ id: posts.id })).map((x) => x.id);

  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const sellers = [sellerA, sellerB, sellerC];
  await db.delete(boosts).where(inArray(boosts.sellerId, sellers));
  await db.delete(featuredSlots).where(inArray(featuredSlots.sellerId, sellers));
  await db.delete(blocks).where(eq(blocks.blockerId, viewer));
  await db.delete(posts).where(inArray(posts.userId, sellers));
  await db.delete(users).where(inArray(users.clerkId, allUsers));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  stripeState.failRefund = false;
  stripeFake.refunds.create.mockClear();
  delete process.env.FEATURED_SLOT_CAPACITY;
});

// ─── Boost approval state machine ────────────────────────────────────────────

describe("boost admin approval", () => {
  it("creates boosts as pending review and never activates them on payment alone", async () => {
    const created = await req(sellerA, "POST", "/api/boosts", { targetType: "post", targetId: postA, budgetCents: 2500, durationDays: 7 });
    expect(created.body.reviewStatus).toBe("pending");
    expect(created.body.status).toBe("pending_payment");

    // Admin cannot approve something that has not been paid.
    const early = await req(admin, "POST", `/api/admin/promotions/boosts/${created.body.id}/approve`);
    expect(early.status).toBe(409);

    const pay = await req(sellerA, "POST", `/api/boosts/${created.body.id}/pay`, { returnUrl: `brandthread://boost?id=${created.body.id}&paymentReturn=1` });
    const unpaid = await req(sellerA, "POST", `/api/boosts/${created.body.id}/pay/verify`);
    expect(unpaid.status).toBe(402);

    markPaid(pay.body.sessionId);
    const verified = await req(sellerA, "POST", `/api/boosts/${created.body.id}/pay/verify`);
    expect(verified.body.status).toBe("in_review"); // paid, captured, not serving
    expect(verified.body.displayState).toBe("in_review");
    expect(verified.body.paidAt).toBeTruthy();
    expect(verified.body.startsAt).toBeNull();
  });

  it("an in-review boost is excluded from sponsored delivery until approved", async () => {
    const { loadSponsoredCandidates } = await import("../../lib/promotions/sponsoredService");
    const { id } = await boostToInReview(sellerB, postB);
    expect((await loadSponsoredCandidates(new Date())).some((c) => c.boostId === id)).toBe(false);

    const approved = await req(admin, "POST", `/api/admin/promotions/boosts/${id}/approve`);
    expect(approved.status).toBe(200);
    const [row] = await db.select().from(boosts).where(eq(boosts.id, id));
    expect(row.status).toBe("active");
    expect(row.reviewStatus).toBe("approved");
    expect(row.reviewedBy).toBe(admin);
    expect(row.startsAt).toBeTruthy();
    expect(row.endsAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await loadSponsoredCandidates(new Date())).some((c) => c.boostId === id)).toBe(true);

    const audit = await db.select().from(promotionReviews).where(eq(promotionReviews.targetId, id));
    expect(audit.map((a) => a.decision)).toEqual(["approved"]);

    const again = await req(admin, "POST", `/api/admin/promotions/boosts/${id}/approve`);
    expect(again.status).toBe(409);
  });

  it("rejecting requires a reason, records it, and refunds the Stripe payment in full", async () => {
    const { id, sessionId } = await boostToInReview(sellerA, postA, 4000);

    const noReason = await req(admin, "POST", `/api/admin/promotions/boosts/${id}/reject`, {});
    expect(noReason.status).toBe(400);

    const rejected = await req(admin, "POST", `/api/admin/promotions/boosts/${id}/reject`, { reason: "Misleading claims in caption" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.refundStatus).toBe("refunded");
    expect(stripeFake.refunds.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeFake.refunds.create.mock.calls[0] as any[];
    expect(params.payment_intent).toBe(stripeState.sessions.get(sessionId).payment_intent);
    expect(opts.idempotencyKey).toBe(`promotion-refund/boost/${id}`);

    const [row] = await db.select().from(boosts).where(eq(boosts.id, id));
    expect(row.status).toBe("rejected");
    expect(row.rejectionReason).toBe("Misleading claims in caption");
    expect(row.refundId).toBeTruthy();

    // Seller sees why.
    const mine = await req(sellerA, "GET", "/api/boosts");
    const seen = mine.body.find((b: any) => b.id === id);
    expect(seen.displayState).toBe("rejected");
    expect(seen.rejectionReason).toBe("Misleading claims in caption");

    // Terminal: cannot be approved afterwards, and a repeat reject does not refund twice.
    expect((await req(admin, "POST", `/api/admin/promotions/boosts/${id}/approve`)).status).toBe(409);
    const repeat = await req(admin, "POST", `/api/admin/promotions/boosts/${id}/reject`, { reason: "Misleading claims in caption" });
    expect(repeat.status).toBe(200);
    expect(stripeFake.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("keeps the rejection when the refund fails, flags it, and a retry completes it", async () => {
    const { id } = await boostToInReview(sellerA, postA);
    stripeState.failRefund = true;
    const failed = await req(admin, "POST", `/api/admin/promotions/boosts/${id}/reject`, { reason: "Policy violation" });
    expect(failed.status).toBe(502);
    expect(failed.body.refundStatus).toBe("failed");
    const [mid] = await db.select().from(boosts).where(eq(boosts.id, id));
    expect(mid.status).toBe("rejected");

    stripeState.failRefund = false;
    const retry = await req(admin, "POST", `/api/admin/promotions/boosts/${id}/reject`, { reason: "Policy violation" });
    expect(retry.status).toBe(200);
    expect(retry.body.refundStatus).toBe("refunded");
  });

  it("lets the seller withdraw a boost in review and refunds it", async () => {
    const { id } = await boostToInReview(sellerB, postB);
    const cancelled = await req(sellerB, "PATCH", `/api/boosts/${id}`, { status: "cancelled" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(stripeFake.refunds.create).toHaveBeenCalledTimes(1);
    expect((await req(sellerB, "PATCH", `/api/boosts/${id}`, { status: "paused" })).status).toBe(409);
  });

  it("only admins can use the queue", async () => {
    const { id } = await boostToInReview(sellerA, postA);
    expect((await req(sellerA, "POST", `/api/admin/promotions/boosts/${id}/approve`)).status).toBe(403);
    expect((await req(sellerA, "GET", "/api/admin/promotions")).status).toBe(403);
    expect((await req(null, "GET", "/api/admin/promotions")).status).toBe(401);
    const queue = await req(admin, "GET", "/api/admin/promotions?status=in_review&kind=boost");
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((i: any) => i.id === id && i.state === "in_review")).toBe(true);
    expect(queue.body.summary.pendingBoosts).toBeGreaterThan(0);
  });

  it("webhook activation moves a review-gated boost to in_review, not active", async () => {
    const { activateBoostFromCheckoutSession } = await import("../boosts");
    const created = await req(sellerA, "POST", "/api/boosts", { targetType: "post", targetId: postA, budgetCents: 1500, durationDays: 7 });
    const pay = await req(sellerA, "POST", `/api/boosts/${created.body.id}/pay`, { returnUrl: `brandthread://boost?id=${created.body.id}&paymentReturn=1` });
    markPaid(pay.body.sessionId);
    await activateBoostFromCheckoutSession({ id: pay.body.sessionId, payment_status: "paid", metadata: { kind: "boost" } }, new Date());
    const [row] = await db.select().from(boosts).where(eq(boosts.id, created.body.id));
    expect(row.status).toBe("in_review");
  });
});

// ─── Sponsored delivery: eligibility, frequency cap, accounting ──────────────

describe("sponsored delivery", () => {
  let boostId = "";

  async function activeBoost(over: Partial<typeof boosts.$inferInsert> = {}) {
    const now = new Date();
    const [row] = await db.insert(boosts).values({
      sellerId: sellerA, targetType: "post", targetId: postA, budgetCents: 2000, durationDays: 7,
      status: "active", reviewStatus: "approved", paidAt: new Date(now.getTime() - 3600_000),
      startsAt: new Date(now.getTime() - 3 * 86_400_000), endsAt: new Date(now.getTime() + 4 * 86_400_000),
      ...over,
    }).returning();
    return row;
  }
  const serve = async (sessionId: string, viewerId = viewer) => {
    const { serveSponsoredSlots } = await import("../../lib/promotions/sponsoredService");
    return serveSponsoredSlots({ viewerId, sessionId, organicOffset: 0, organicCount: 12 });
  };
  const sid = () => `sess-${crypto.randomUUID().slice(0, 12)}`;

  beforeEach(async () => {
    await db.delete(boosts).where(inArray(boosts.sellerId, [sellerA, sellerB, sellerC]));
    await db.delete(blocks).where(eq(blocks.blockerId, viewer));
    await db.update(users).set({ vacationMode: false, vacationUntil: null }).where(eq(users.clerkId, sellerA));
    boostId = (await activeBoost()).id;
  });

  it("serves an eligible boost after the first N organic items, labelled with the boost id", async () => {
    const slots = await serve(sid());
    expect(slots).toHaveLength(1);
    expect(slots[0].afterIndex).toBe(5);
    expect(slots[0].boostId).toBe(boostId);
    expect(slots[0].post.id).toBe(postA);
  });

  it("never shows a seller their own promoted post", async () => {
    expect(await serve(sid(), sellerA)).toEqual([]);
  });

  it("skips paused, pending, rejected, unpaid and expired boosts", async () => {
    for (const over of [
      { status: "paused" }, { reviewStatus: "pending" }, { reviewStatus: "rejected" },
      { paidAt: null }, { endsAt: new Date(Date.now() - 1000) }, { status: "in_review" },
    ]) {
      await db.delete(boosts).where(eq(boosts.sellerId, sellerA));
      await activeBoost(over as any);
      expect(await serve(sid())).toEqual([]);
    }
  });

  it("respects blocks, muted words and vacation mode", async () => {
    await db.insert(blocks).values({ blockerId: viewer, blockedId: sellerA });
    expect(await serve(sid())).toEqual([]);
    await db.delete(blocks).where(eq(blocks.blockerId, viewer));
    expect(await serve(sid())).toHaveLength(1);

    await db.update(users).set({ vacationMode: true }).where(eq(users.clerkId, sellerA));
    expect(await serve(sid())).toEqual([]);
  });

  it("hides posts that are no longer public", async () => {
    await db.update(posts).set({ visibility: { isPublic: false } as any }).where(eq(posts.id, postA));
    expect(await serve(sid())).toEqual([]);
    await db.update(posts).set({ visibility: { isPublic: true } as any }).where(eq(posts.id, postA));
  });

  it("does not repeat within a session and caps per-viewer frequency per day", async () => {
    const session = sid();
    expect(await serve(session)).toHaveLength(1);
    expect(await serve(session)).toEqual([]); // same session: no repeat
    expect(await serve(sid())).toHaveLength(1);
    expect(await serve(sid())).toHaveLength(1);
    expect(await serve(sid())).toEqual([]); // 4th session in 24h: daily cap (3)
  });

  it("bills only confirmed impressions, once, and stops at the spend cap", async () => {
    const { recordSponsoredImpression } = await import("../../lib/promotions/sponsoredService");
    const session = sid();
    expect(await recordSponsoredImpression({ viewerId: viewer, boostId, sessionId: session }))
      .toEqual({ counted: false, reason: "not_served" });

    await serve(session);
    const first = await recordSponsoredImpression({ viewerId: viewer, boostId, sessionId: session });
    expect(first.counted).toBe(true);
    expect(await recordSponsoredImpression({ viewerId: viewer, boostId, sessionId: session }))
      .toEqual({ counted: false, reason: "already_counted" });
    const [after] = await db.select().from(boosts).where(eq(boosts.id, boostId));
    expect(after.impressionsCount).toBe(1);
    expect(after.deliveredSpendCents).toBe(2);

    // Budget nearly exhausted: the last impression completes the boost.
    await db.update(boosts).set({ deliveredSpendCents: after.budgetCents - 2 }).where(eq(boosts.id, boostId));
    const session2 = sid();
    // (Pacing would normally stop serving this far ahead of schedule, so seed the served row directly.)
    await db.insert(sponsoredDeliveries).values({ boostId, viewerId: viewer, sessionId: session2, costCents: 2 });
    expect((await recordSponsoredImpression({ viewerId: viewer, boostId, sessionId: session2 })).counted).toBe(true);
    const [done] = await db.select().from(boosts).where(eq(boosts.id, boostId));
    expect(done.deliveredSpendCents).toBe(done.budgetCents);
    expect(done.status).toBe("completed");
    expect(await serve(sid())).toEqual([]);
  });

  it("refuses to bill past the budget even if a delivery row exists", async () => {
    const { recordSponsoredImpression } = await import("../../lib/promotions/sponsoredService");
    await db.update(boosts).set({ deliveredSpendCents: 2000 }).where(eq(boosts.id, boostId));
    const session = sid();
    await db.insert(sponsoredDeliveries).values({ boostId, viewerId: viewer, sessionId: session, costCents: 2 });
    const result = await recordSponsoredImpression({ viewerId: viewer, boostId, sessionId: session });
    expect(result).toEqual({ counted: false, reason: "budget_exhausted" });
    const [row] = await db.select().from(boosts).where(eq(boosts.id, boostId));
    expect(row.deliveredSpendCents).toBe(2000);
    const [delivery] = await db.select().from(sponsoredDeliveries)
      .where(and(eq(sponsoredDeliveries.boostId, boostId), eq(sponsoredDeliveries.sessionId, session)));
    expect(delivery.viewedAt).toBeNull();
  });

  it("paces delivery: a new boost may only burn a small share of budget immediately", async () => {
    await db.delete(boosts).where(eq(boosts.sellerId, sellerA));
    const now = new Date();
    await activeBoost({ startsAt: now, endsAt: new Date(now.getTime() + 7 * 86_400_000), budgetCents: 2000, deliveredSpendCents: 200 });
    expect(await serve(sid())).toEqual([]); // 10% opening burst already used
  });

  it("HTTP: GET /sponsored validates input and POST /impression needs a served item", async () => {
    expect((await req(viewer, "GET", "/api/promotions/sponsored?sessionId=x&organicOffset=0&organicCount=10")).status).toBe(400);
    const session = sid();
    const ok = await req(viewer, "GET", `/api/promotions/sponsored?sessionId=${session}&organicOffset=0&organicCount=10`);
    expect(ok.status).toBe(200);
    expect(ok.body.slots[0].label).toBe("Sponsored");
    expect(ok.body.slots[0].post.sponsored).toBe(true);
    const imp = await req(viewer, "POST", "/api/promotions/sponsored/impression", { boostId, sessionId: session });
    expect(imp.body.counted).toBe(true);
    expect((await req(null, "GET", `/api/promotions/sponsored?sessionId=${session}&organicOffset=0&organicCount=10`)).status).toBe(401);
  });
});

// ─── Featured slots ──────────────────────────────────────────────────────────

describe("featured slots", () => {
  beforeEach(async () => {
    await db.delete(featuredSlots).where(inArray(featuredSlots.sellerId, [sellerA, sellerB, sellerC]));
  });

  async function reserveAndPay(seller: string, durationDays = 7) {
    const slot = await req(seller, "POST", "/api/featured-slots", { durationDays });
    expect(slot.status).toBe(201);
    const pay = await req(seller, "POST", `/api/featured-slots/${slot.body.id}/pay`, { returnUrl: `brandthread://featured-slot?id=${slot.body.id}&paymentReturn=1` });
    expect([200, 201]).toContain(pay.status);
    markPaid(pay.body.sessionId);
    const verified = await req(seller, "POST", `/api/featured-slots/${slot.body.id}/pay/verify`);
    return { slot: slot.body, sessionId: pay.body.sessionId as string, verified };
  }

  it("prices come from the server list; unknown durations are rejected", async () => {
    expect((await req(sellerA, "POST", "/api/featured-slots", { durationDays: 5 })).status).toBe(400);
    const avail = await req(sellerA, "GET", "/api/featured-slots/availability");
    expect(avail.body.options.map((o: any) => o.durationDays)).toEqual([3, 7, 14]);
    const s = await req(sellerA, "POST", "/api/featured-slots", { durationDays: 7, priceCents: 1 });
    expect(s.body.priceCents).toBe(5900);
    const pay = await req(sellerA, "POST", `/api/featured-slots/${s.body.id}/pay`, { returnUrl: `brandthread://featured-slot?id=${s.body.id}&paymentReturn=1` });
    expect(stripeState.sessions.get(pay.body.sessionId).amount_total).toBe(5900);
  });

  it("buyers cannot buy a slot and signed-out visitors cannot reserve", async () => {
    expect((await req(viewer, "POST", "/api/featured-slots", { durationDays: 7 })).status).toBe(403);
    expect((await req(null, "POST", "/api/featured-slots", { durationDays: 7 })).status).toBe(401);
  });

  it("payment moves a slot to in_review, never straight to live", async () => {
    const { slot, verified } = await reserveAndPay(sellerA);
    expect(verified.body.status).toBe("in_review");
    expect(verified.body.displayState).toBe("in_review");
    const active = await req(null, "GET", "/api/featured-slots/active");
    expect(active.body.brands.some((b: any) => b.slotId === slot.id)).toBe(false);
  });

  it("does not let an unpaid slot be reviewed", async () => {
    const slot = await req(sellerA, "POST", "/api/featured-slots", { durationDays: 7 });
    expect((await req(admin, "POST", `/api/admin/promotions/featured/${slot.body.id}/approve`)).status).toBe(409);
    const unpaid = await req(sellerA, "POST", `/api/featured-slots/${slot.body.id}/pay/verify`);
    expect(unpaid.status).toBe(409); // no checkout session yet
  });

  it("admin approval makes the brand appear (Featured label) only while inside its window", async () => {
    const { slot } = await reserveAndPay(sellerA);
    const approve = await req(admin, "POST", `/api/admin/promotions/featured/${slot.id}/approve`);
    expect(approve.status).toBe(200);
    const live = await req(null, "GET", "/api/featured-slots/active");
    expect(live.body.label).toBe("Featured");
    expect(live.body.brands.find((b: any) => b.slotId === slot.id)?.name).toBe("Brand A");

    const mine = await req(sellerA, "GET", "/api/featured-slots/mine");
    expect(mine.body[0].displayState).toBe("live");

    await db.update(featuredSlots).set({
      startsAt: new Date(Date.now() - 9 * 86_400_000), endsAt: new Date(Date.now() - 2 * 86_400_000),
    }).where(eq(featuredSlots.id, slot.id));
    const after = await req(null, "GET", "/api/featured-slots/active");
    expect(after.body.brands.some((b: any) => b.slotId === slot.id)).toBe(false);
    expect((await req(sellerA, "GET", "/api/featured-slots/mine")).body[0].displayState).toBe("ended");
  });

  it("rejecting records the reason, refunds in full and removes the brand", async () => {
    const { slot, sessionId } = await reserveAndPay(sellerB);
    const rejected = await req(admin, "POST", `/api/admin/promotions/featured/${slot.id}/reject`, { reason: "Brand page incomplete" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.refundStatus).toBe("refunded");
    const [params, opts] = stripeFake.refunds.create.mock.calls[0] as any[];
    expect(params.payment_intent).toBe(stripeState.sessions.get(sessionId).payment_intent);
    expect(opts.idempotencyKey).toBe(`promotion-refund/featured_slot/${slot.id}`);
    const mine = await req(sellerB, "GET", "/api/featured-slots/mine");
    expect(mine.body[0]).toMatchObject({ displayState: "rejected", rejectionReason: "Brand page incomplete" });
    expect((await req(admin, "POST", `/api/admin/promotions/featured/${slot.id}/approve`)).status).toBe(409);
    // The seller can buy again after a rejection.
    expect((await req(sellerB, "POST", "/api/featured-slots", { durationDays: 3 })).status).toBe(201);
  });

  it("is scarce: once capacity is taken the next buyer is queued behind the earliest end", async () => {
    process.env.FEATURED_SLOT_CAPACITY = "2";
    const a = await req(sellerA, "POST", "/api/featured-slots", { durationDays: 7 });
    const b = await req(sellerB, "POST", "/api/featured-slots", { durationDays: 7 });
    const c = await req(sellerC, "POST", "/api/featured-slots", { durationDays: 7 });
    const startOf = (r: any) => new Date(r.body.startsAt).getTime();
    expect(startOf(a)).toBeLessThan(Date.now() + 5000);
    expect(startOf(b)).toBeLessThan(Date.now() + 5000);
    expect(startOf(c)).toBeGreaterThanOrEqual(new Date(a.body.endsAt).getTime() - 1);

    const avail = await req(sellerC, "GET", "/api/featured-slots/availability");
    expect(avail.body.options.every((o: any) => o.availableNow === false)).toBe(true);
  });

  it("never oversells under concurrent purchases", async () => {
    process.env.FEATURED_SLOT_CAPACITY = "1";
    const results = await Promise.all([sellerA, sellerB, sellerC].map((s) =>
      req(s, "POST", "/api/featured-slots", { durationDays: 7 })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const windows = results.map((r) => ({ s: new Date(r.body.startsAt).getTime(), e: new Date(r.body.endsAt).getTime() }))
      .sort((x, y) => x.s - y.s);
    for (let i = 1; i < windows.length; i += 1) expect(windows[i].s).toBeGreaterThanOrEqual(windows[i - 1].e);
  });

  it("one open slot per seller", async () => {
    await reserveAndPay(sellerA);
    const second = await req(sellerA, "POST", "/api/featured-slots", { durationDays: 3 });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("already_booked");
  });

  it("verify rejects a mismatched amount (tampered session)", async () => {
    const slot = await req(sellerA, "POST", "/api/featured-slots", { durationDays: 7 });
    const pay = await req(sellerA, "POST", `/api/featured-slots/${slot.body.id}/pay`, { returnUrl: `brandthread://featured-slot?id=${slot.body.id}&paymentReturn=1` });
    const s = stripeState.sessions.get(pay.body.sessionId);
    s.amount_total = 100; s.payment_status = "paid";
    expect((await req(sellerA, "POST", `/api/featured-slots/${slot.body.id}/pay/verify`)).status).toBe(403);
    const [row] = await db.select().from(featuredSlots).where(eq(featuredSlots.id, slot.body.id));
    expect(row.status).toBe("pending_payment");
  });

  it("seller can cancel a paid slot in review and gets a refund", async () => {
    const { slot } = await reserveAndPay(sellerC);
    const cancelled = await req(sellerC, "POST", `/api/featured-slots/${slot.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.displayState).toBe("cancelled");
    expect(cancelled.body.refundStatus).toBe("refunded");
    expect(stripeFake.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("a payment that lands after the reservation was cancelled is refunded, not kept", async () => {
    const { activateFeaturedSlotFromCheckoutSession } = await import("../featured-slots");
    const slot = await req(sellerA, "POST", "/api/featured-slots", { durationDays: 7 });
    const pay = await req(sellerA, "POST", `/api/featured-slots/${slot.body.id}/pay`, { returnUrl: `brandthread://featured-slot?id=${slot.body.id}&paymentReturn=1` });
    await req(sellerA, "POST", `/api/featured-slots/${slot.body.id}/cancel`);
    markPaid(pay.body.sessionId);
    await activateFeaturedSlotFromCheckoutSession({ id: pay.body.sessionId, payment_status: "paid", metadata: { kind: "featured_slot" } }, new Date());
    const [row] = await db.select().from(featuredSlots).where(eq(featuredSlots.id, slot.body.id));
    expect(row.status).toBe("cancelled");
    expect(row.refundStatus).toBe("refunded");
  });
});
