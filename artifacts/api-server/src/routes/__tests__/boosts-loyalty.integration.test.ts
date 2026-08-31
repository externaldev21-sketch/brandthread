/**
 * Task 252: HTTP-level boosts and loyalty coverage.  These tests intentionally
 * mount the routers themselves: authentication is supplied by x-test-user and
 * app-level subscription/plan middleware is not part of this contract.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { boosts, db, loyaltyPoints, posts, products, users } from "@workspace/db";

const stripeState = vi.hoisted(() => ({ paymentMethod: true, decline: false, charges: [] as any[] }));
const stripeFake = vi.hoisted(() => ({
  customers: {
    retrieve: vi.fn(async () => stripeState.paymentMethod
      ? { invoice_settings: { default_payment_method: "pm_boost_test" } }
      : { invoice_settings: { default_payment_method: null } }),
  },
  paymentIntents: {
    create: vi.fn(async (params: any) => {
      stripeState.charges.push(params);
      if (stripeState.decline) {
        const error: any = new Error("declined");
        error.code = "card_declined";
        throw error;
      }
      return { id: `pi_boost_${stripeState.charges.length}`, status: "succeeded" };
    }),
  },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../lib/stripe", () => ({ requireStripe: () => stripeFake }));

const tag = crypto.randomUUID();
const seller = `boost-seller-${tag}`;
const stranger = `boost-stranger-${tag}`;
const buyer = `loyalty-buyer-${tag}`;
const otherBuyer = `loyalty-other-${tag}`;
let postId = "";
let strangerPostId = "";
let productId = "";
let server: Server;
let base = "";

async function request(user: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const boostPayload = (overrides: Record<string, unknown> = {}) => ({
  targetType: "post", targetId: postId, objective: "views", budgetCents: 500, durationDays: 7, ...overrides,
});

beforeAll(async () => {
  const [{ default: boostsRouter }, { default: loyaltyRouter }] = await Promise.all([
    import("../boosts"), import("../loyalty"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/boosts", boostsRouter);
  app.use("/api/loyalty", loyaltyRouter);
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "Boost Seller", role: "seller", accountType: "seller", stripeCustomerId: `cus_${tag}` },
    { clerkId: stranger, email: `${stranger}@test.local`, name: "Other Seller", role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@test.local`, name: "Loyal Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: otherBuyer, email: `${otherBuyer}@test.local`, name: "Other Buyer", role: "buyer", accountType: "buyer" },
  ]);
  [postId] = (await db.insert(posts).values({ userId: seller, mediaUrl: "https://example.test/owned.jpg", caption: "owned" }).returning({ id: posts.id })).map(x => x.id);
  [strangerPostId] = (await db.insert(posts).values({ userId: stranger, mediaUrl: "https://example.test/other.jpg" }).returning({ id: posts.id })).map(x => x.id);
  [productId] = (await db.insert(products).values({ ownerId: seller, name: "Boostable product", category: "apparel", status: "active" }).returning({ id: products.id })).map(x => x.id);
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(boosts).where(and(eq(boosts.sellerId, seller)));
  await db.delete(loyaltyPoints).where(sql`${loyaltyPoints.buyerId} IN (${buyer}, ${otherBuyer})`);
  await db.delete(posts).where(sql`${posts.userId} IN (${seller}, ${stranger})`);
  await db.delete(products).where(eq(products.ownerId, seller));
  await db.delete(users).where(sql`${users.clerkId} IN (${seller}, ${stranger}, ${buyer}, ${otherBuyer})`);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("boosts HTTP integration", () => {
  it("lists only owned promotion targets and validates each create input", async () => {
    const targets = await request(seller, "GET", "/api/boosts/targets");
    expect(targets.status).toBe(200);
    expect(targets.body.map((row: any) => row.id)).toContain(postId);
    expect(targets.body.map((row: any) => row.id)).not.toContain(strangerPostId);
    for (const payload of [
      boostPayload({ targetType: "profile" }), boostPayload({ targetId: "" }),
      boostPayload({ objective: "sales" }), boostPayload({ budgetCents: 499 }),
      boostPayload({ budgetCents: 100_001 }), boostPayload({ budgetCents: 500.5 }),
      boostPayload({ durationDays: 0 }), boostPayload({ durationDays: 91 }),
    ]) expect((await request(seller, "POST", "/api/boosts", payload)).status).toBe(400);
    expect((await request(seller, "POST", "/api/boosts", boostPayload({ targetId: strangerPostId }))).status).toBe(404);
    expect((await request(seller, "POST", "/api/boosts", boostPayload({ targetType: "product", targetId: productId, objective: "likes" }))).status).toBe(201);
  });

  it("charges a stored card, handles card declines, and records paid boost fields", async () => {
    stripeState.paymentMethod = true;
    stripeState.decline = false;
    const created = await request(seller, "POST", "/api/boosts", boostPayload({ budgetCents: 750, objective: "followers", durationDays: 3 }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ sellerId: seller, status: "active", paid: true, spentCents: 750, estimatedImpressions: 300, durationDays: 3 });
    expect(stripeState.charges.at(-1)).toMatchObject({ amount: 750, customer: `cus_${tag}`, metadata: { sellerId: seller, targetId: postId, objective: "followers" } });
    stripeState.decline = true;
    const declined = await request(seller, "POST", "/api/boosts", boostPayload());
    expect(declined).toMatchObject({ status: 402, body: { code: "card_declined" } });
    stripeState.decline = false;
    stripeState.paymentMethod = false;
    const unpaid = await request(seller, "POST", "/api/boosts", boostPayload({ objective: "likes" }));
    expect(unpaid.body).toMatchObject({ paid: false, spentCents: 0 });
    stripeState.paymentMethod = true;
  });

  it("returns scoped listings, summary totals, active post filtering, expiry and lifecycle errors", async () => {
    const [old] = await db.insert(boosts).values({
      sellerId: seller, targetType: "post", targetId: postId, objective: "views", budgetCents: 600,
      spentCents: 600, impressionsCount: 33, status: "active", durationDays: 1, endsAt: new Date(Date.now() - 1_000),
    }).returning();
    const [completed] = await db.insert(boosts).values({
      sellerId: seller, targetType: "post", targetId: postId, objective: "views", budgetCents: 500,
      spentCents: 500, impressionsCount: 17, status: "completed", durationDays: 1, endsAt: new Date(Date.now() + 86_400_000),
    }).returning();
    const list = await request(seller, "GET", `/api/boosts?targetId=${postId}`);
    expect(list.status).toBe(200);
    expect(list.body.every((row: any) => row.targetId === postId && row.sellerId === seller)).toBe(true);
    expect(list.body.find((row: any) => row.id === old.id).estimatedImpressions).toBe(240);
    let expired = (await db.select().from(boosts).where(eq(boosts.id, old.id)))[0];
    for (let attempt = 0; expired?.status !== "completed" && attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      expired = (await db.select().from(boosts).where(eq(boosts.id, old.id)))[0];
    }
    expect(expired.status).toBe("completed");
    const active = await request(seller, "GET", `/api/boosts/active-post-ids?ids=${postId}&ids=${strangerPostId}`);
    expect(active.body).toContain(postId);
    expect(active.body).not.toContain(strangerPostId);
    expect((await request(seller, "GET", "/api/boosts/active-post-ids")).body).toEqual([]);
    const summary = await request(seller, "GET", "/api/boosts/summary");
    expect(summary.body.totalImpressions).toBeGreaterThanOrEqual(50);
    expect(summary.body.spentCentsThisMonth).toBeGreaterThanOrEqual(1_850);
    expect(summary.body.activeCount).toBeGreaterThanOrEqual(1);
    expect((await request(seller, "PATCH", `/api/boosts/${completed.id}`, { status: "paused" })).status).toBe(409);
    expect((await request(seller, "PATCH", `/api/boosts/${postId}`, { status: "active" })).status).toBe(400);
    expect((await request(stranger, "PATCH", `/api/boosts/${completed.id}`, { status: "cancelled" })).status).toBe(404);
  });

  it("handles concurrent independent create mutations without cross-seller rows", async () => {
    const results = await Promise.all([
      request(seller, "POST", "/api/boosts", boostPayload({ objective: "profile_visits" })),
      request(seller, "POST", "/api/boosts", boostPayload({ objective: "views", budgetCents: 501 })),
    ]);
    expect(results.map(x => x.status)).toEqual([201, 201]);
    expect(new Set(results.map(x => x.body.id)).size).toBe(2);
    expect((await request(stranger, "GET", "/api/boosts")).body).toEqual([]);
  });
});

describe("loyalty HTTP and ledger integration", () => {
  it("exposes isolated balance/history, rejects direct earn, and redeems exact balances only", async () => {
    await db.insert(loyaltyPoints).values([
      { buyerId: buyer, points: 200, source: "bonus", referenceId: `seed-${tag}` },
      { buyerId: otherBuyer, points: 900, source: "bonus", referenceId: `other-${tag}` },
    ]);
    const initial = await request(buyer, "GET", "/api/loyalty");
    expect(initial.body).toMatchObject({ balance: 200, valueCents: 200 });
    expect(initial.body.history).toHaveLength(1);
    expect((await request(buyer, "POST", "/api/loyalty/earn", { points: 999 })).status).toBe(403);
    expect((await request(buyer, "POST", "/api/loyalty/redeem", { points: 99 })).status).toBe(400);
    expect((await request(buyer, "POST", "/api/loyalty/redeem", { points: 201 })).body.code).toBe("INSUFFICIENT_POINTS");
    const exact = await request(buyer, "POST", "/api/loyalty/redeem", { points: 200 });
    expect(exact).toMatchObject({ status: 200, body: { ok: true, pointsUsed: 200, discountCents: 200 } });
    expect(exact.body.token).toMatch(/^LOYAL-/);
    expect((await request(buyer, "GET", "/api/loyalty")).body.balance).toBe(0);
    expect((await request(otherBuyer, "GET", "/api/loyalty")).body).toMatchObject({ balance: 900 });
  });

  it("reserves, binds, consumes and releases redemptions; awards and reversals are idempotent under concurrency", async () => {
    const loyalty = await import("../loyalty");
    const token = `LOYAL-${crypto.randomUUID().toUpperCase()}`;
    await db.insert(loyaltyPoints).values({ buyerId: buyer, points: -150, source: "redemption", referenceId: token });
    await expect(loyalty.reserveLoyaltyRedemption(buyer, token, "reserve-a", 150)).rejects.toMatchObject({ code: "LOYALTY_DISCOUNT_TOO_LARGE" });
    expect(await loyalty.reserveLoyaltyRedemption(buyer, token, "reserve-a", 500)).toMatchObject({ pointsUsed: 150 });
    await expect(loyalty.reserveLoyaltyRedemption(otherBuyer, token, "reserve-b", 500)).rejects.toMatchObject({ code: "LOYALTY_TOKEN_INVALID" });
    await loyalty.bindLoyaltyRedemptionToCheckout(buyer, token, "reserve-a", "checkout-a");
    await db.transaction(tx => loyalty.consumeLoyaltyRedemption(tx, buyer, token, "checkout-a", crypto.randomUUID()));
    const releasable = `LOYAL-${crypto.randomUUID().toUpperCase()}`;
    await db.insert(loyaltyPoints).values({ buyerId: buyer, points: -100, source: "redemption", referenceId: releasable, checkoutSessionId: "checkout-release" });
    await db.transaction(tx => loyalty.releaseLoyaltyRedemption(tx, buyer, releasable, "checkout-release"));
    const [released] = await db.select().from(loyaltyPoints).where(eq(loyaltyPoints.referenceId, releasable));
    expect(released.checkoutSessionId).toBeNull();
    const orderId = crypto.randomUUID();
    const awards = await Promise.all(Array.from({ length: 3 }, () => loyalty.awardLoyaltyPointsOnce({ buyerId: buyer, points: 40, source: "order_earn", referenceId: orderId })));
    expect(awards.filter(x => x.created)).toHaveLength(1);
    const reversals = await Promise.all([
      loyalty.reversePurchasePointsOnce({ buyerId: buyer, orderId, referenceId: `${orderId}:one`, requestedPoints: 25 }),
      loyalty.reversePurchasePointsOnce({ buyerId: buyer, orderId, referenceId: `${orderId}:two`, requestedPoints: 25 }),
    ]);
    expect(reversals.reduce((total, row) => total + row.pointsReversed, 0)).toBe(40);
    expect((await loyalty.reversePurchasePointsOnce({ buyerId: buyer, orderId, referenceId: `${orderId}:one`, requestedPoints: 25 })).created).toBe(false);
  });
});