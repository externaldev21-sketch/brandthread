import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, loyaltyPoints, notificationsFeed, orders, referrals, threadCashEntries, users,
} from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../lib/push", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sendPushToUser: vi.fn(async () => {}),
}));

const suffix = crypto.randomBytes(5).toString("hex");
const inviterId = `ref-inviter-${suffix}`;
const friendA = `ref-friend-a-${suffix}`;
const friendB = `ref-friend-b-${suffix}`;
const friendC = `ref-friend-c-${suffix}`;
const veteran = `ref-veteran-${suffix}`;
const allIds = [inviterId, friendA, friendB, friendC, veteran];
let code = "";
let server: Server;
let base = "";

async function call(method: string, path: string, userId?: string, body?: unknown) {
  const res = await fetch(`${base}/api/referrals${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user": userId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function placeOrder(buyerId: string, totalCents: number, extra: Partial<typeof orders.$inferInsert> = {}) {
  const [order] = await db.insert(orders).values({
    ownerId: `ref-seller-${suffix}`,
    buyerId,
    orderNumber: `BT-REF-${crypto.randomBytes(4).toString("hex")}`,
    status: "processing",
    totalCents,
    subtotalCents: totalCents,
    ...extra,
  }).returning({ id: orders.id });
  return order.id;
}

async function balance(buyerId: string) {
  const rows = await db.select({ amount: threadCashEntries.amountCents }).from(threadCashEntries)
    .where(eq(threadCashEntries.buyerId, buyerId));
  return rows.reduce((s, r) => s + r.amount, 0);
}

beforeAll(async () => {
  for (const id of allIds) {
    await db.insert(users).values({ clerkId: id, email: `${id}@example.com`, name: id, accountType: "buyer" });
  }
  const { default: router } = await import("../referrals");
  const app = express();
  app.use(express.json());
  app.use("/api/referrals", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, allIds));
  await db.delete(loyaltyPoints).where(inArray(loyaltyPoints.buyerId, allIds));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, allIds));
  await db.delete(orders).where(inArray(orders.buyerId, allIds));
  await db.delete(referrals).where(eq(referrals.inviterId, inviterId));
  await db.delete(users).where(inArray(users.clerkId, allIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("referral program: give $10 / get $10 Thread Cash", () => {
  it("generates a code, returns the new link and tracks public link clicks without PII", async () => {
    const { status, body } = await call("GET", "/code", inviterId);
    expect(status).toBe(200);
    code = body.code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(body.link).toBe(`https://brandthread.app/invite/${code}`);
    expect(body.shareText).toContain("$10 Thread Cash");

    const click = await call("GET", `/invite/${code.toLowerCase()}`);
    expect(click.status).toBe(200);
    expect(click.body).toMatchObject({ valid: true, code });
    expect(JSON.stringify(click.body)).not.toContain(inviterId);
    expect((await call("GET", "/invite/NOSUCH9")).status).toBe(404);

    const stats = await call("GET", "/stats", inviterId);
    expect(stats.body.clicks).toBe(1);
  });

  it("gives the invitee $10 on joining and the inviter 500 points (unchanged), exactly once", async () => {
    const first = await call("POST", "/apply", friendA, { code });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, inviterId, inviteeRewardCents: 1000 });

    const again = await call("POST", "/apply", friendA, { code });
    expect(again.status).toBe(409);

    expect(await balance(friendA)).toBe(1000);
    expect(await balance(inviterId)).toBe(0); // inviter waits for the first paid order
    const points = await db.select().from(loyaltyPoints)
      .where(and(eq(loyaltyPoints.buyerId, inviterId), eq(loyaltyPoints.source, "referral")));
    expect(points.map((p) => p.points)).toEqual([500]);

    const [entry] = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, friendA));
    expect(entry).toMatchObject({ source: "referral", idempotencyKey: `referral:${friendA}:invitee` });
  });

  it("rejects self-referral, unknown codes and existing customers", async () => {
    expect((await call("POST", "/apply", inviterId, { code })).status).toBe(400);
    expect((await call("POST", "/apply", friendB, { code: "ZZZZZZ" })).status).toBe(404);
    await placeOrder(veteran, 5000);
    const vet = await call("POST", "/apply", veteran, { code });
    expect(vet.status).toBe(409);
    expect(vet.body.code).toBe("NOT_NEW_CUSTOMER");
    expect(await balance(veteran)).toBe(0);
  });

  it("pays the inviter $10 once, on the invitee's first qualifying order", async () => {
    const { qualifyReferralForOrder } = await import("../../lib/referrals/rewards");

    // Below the minimum: nothing happens.
    const small = await placeOrder(friendA, 900);
    expect(await qualifyReferralForOrder(small)).toEqual({ rewarded: false, reason: "below_minimum" });
    // Paid entirely with Thread Cash: no real money, no reward.
    const cashOnly = await placeOrder(friendA, 3000, { threadCashAppliedCents: 2500 });
    expect(await qualifyReferralForOrder(cashOnly)).toEqual({ rewarded: false, reason: "below_minimum" });
    expect(await balance(inviterId)).toBe(0);

    const real = await placeOrder(friendA, 3000);
    const results = await Promise.all([
      qualifyReferralForOrder(real), qualifyReferralForOrder(real), qualifyReferralForOrder(real),
    ]);
    expect(results.filter((r) => r.rewarded)).toHaveLength(1);
    expect(await balance(inviterId)).toBe(1000);

    // A later order or webhook redelivery never pays again.
    const later = await placeOrder(friendA, 9000);
    expect(await qualifyReferralForOrder(later)).toMatchObject({ rewarded: false });
    expect(await qualifyReferralForOrder(real)).toMatchObject({ rewarded: false });
    expect(await balance(inviterId)).toBe(1000);

    const [ref] = await db.select().from(referrals).where(eq(referrals.inviteeId, friendA));
    expect(ref).toMatchObject({ status: "rewarded", inviterRewardCents: 1000, qualifyingOrderId: real });
    const [credit] = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, inviterId));
    expect(credit).toMatchObject({ source: "referral", idempotencyKey: `referral:${friendA}:inviter` });

    const feed = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, inviterId));
    expect(feed.filter((n) => n.type === "referral_reward")).toHaveLength(1);
  });

  it("stops paying the inviter after the cap but still attributes the friend", async () => {
    // Put the inviter at the cap with 50 already-rewarded referrals.
    const fillers = Array.from({ length: 49 }, (_, i) => `ref-filler-${suffix}-${i}`);
    await db.insert(referrals).values(fillers.map((id) => ({
      inviterId, inviteeId: id, inviteCode: code, status: "rewarded", inviterRewardCents: 1000,
    })));
    try {
      expect((await call("POST", "/apply", friendB, { code })).status).toBe(200);
      const { qualifyReferralForOrder } = await import("../../lib/referrals/rewards");
      const orderId = await placeOrder(friendB, 4000);
      expect(await qualifyReferralForOrder(orderId)).toEqual({ rewarded: false, reason: "capped" });
      const [ref] = await db.select().from(referrals).where(eq(referrals.inviteeId, friendB));
      expect(ref.status).toBe("capped");
      expect(await balance(inviterId)).toBe(1000);

      const stats = await call("GET", "/stats", inviterId);
      expect(stats.body.earnedCents).toBe(50_000);
      expect(stats.body.referrals.find((r: any) => r.inviteeId === friendB).status).toBe("capped");
    } finally {
      await db.delete(referrals).where(inArray(referrals.inviteeId, fillers));
    }
  });

  it("reports pending vs earned in stats", async () => {
    expect((await call("POST", "/apply", friendC, { code })).status).toBe(200);
    const stats = await call("GET", "/stats", inviterId);
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ total: 3, earnedCents: 1000, pendingCents: 1000, pointsEarned: 1500 });
    const statuses = Object.fromEntries(stats.body.referrals.map((r: any) => [r.inviteeId, r.status]));
    expect(statuses).toMatchObject({ [friendA]: "rewarded", [friendB]: "capped", [friendC]: "pending" });
  });
});
