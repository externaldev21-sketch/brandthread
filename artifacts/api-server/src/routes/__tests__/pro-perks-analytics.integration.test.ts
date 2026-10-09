/**
 * Brandthread Pro: GET /api/seller/subscription/perks and the Pro-only
 * GET /api/analytics/advanced (requirePlan("pro") on the real middleware).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `pro-perks-seller-${suffix}`;
const state = vi.hoisted(() => ({ planId: "starter" as string, fail: false }));

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: state.planId ? "pro-perks-user" : null }) }));
vi.mock("../../lib/nativeEntitlements", () => ({
  getEffectiveEntitlement: async () => {
    if (state.fail) throw new Error("database unavailable");
    return { planId: state.planId, status: "active", provider: "stripe", native: null };
  },
  reconcileRevenueCatEntitlement: async () => null,
}));
vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, _res: unknown, next: () => void) => {
      req.clerkUserId = `pro-perks-seller-${process.env.PRO_PERKS_SUFFIX}`;
      next();
    },
  };
});
vi.mock("../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireRole")>();
  return { ...actual, teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next() };
});

let server: Server;
let base = "";
let orderCounter = 0;

async function makeOrder(buyerId: string, totalCents: number, createdAt: Date, status = "processing") {
  orderCounter += 1;
  await db.insert(orders).values({
    ownerId: sellerId, buyerId, orderNumber: `PP-${suffix}-${orderCounter}`, status,
    totalCents, subtotalCents: totalCents, paidAt: createdAt, createdAt,
  });
}

beforeAll(async () => {
  process.env.PRO_PERKS_SUFFIX = suffix;
  await db.insert(users).values({
    clerkId: sellerId, email: `${sellerId}@test.local`, name: "Pro Perks", displayName: "Pro Perks",
    role: "seller", accountType: "seller",
  });
  const now = new Date();
  // Two buyers this month (one repeats), one cancelled order that must be ignored.
  await makeOrder("buyer-a", 4000, now);
  await makeOrder("buyer-a", 6000, now);
  await makeOrder("buyer-b", 5000, now);
  await makeOrder("buyer-c", 9999, now, "cancelled");

  const { default: analyticsRouter } = await import("../analytics");
  const { default: subscriptionRouter } = await import("../subscription");
  const app = express();
  app.use(express.json());
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/seller/subscription", subscriptionRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.ownerId, sellerId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.planId = "starter";
  state.fail = false;
});

describe("GET /api/seller/subscription/perks", () => {
  it("returns all three plans from the server config with the caller's plan", async () => {
    state.planId = "growth";
    const res = await fetch(`${base}/api/seller/subscription/perks`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.currentPlan).toBe("growth");
    expect(body.hasAdvancedAnalytics).toBe(false);
    expect(body.plans).toEqual([
      expect.objectContaining({ planId: "starter", amountCents: 2900, platformFeeBps: 500, monthlyAiCredits: 1000, advancedAnalytics: false }),
      expect.objectContaining({ planId: "growth", amountCents: 7900, platformFeeBps: 500, monthlyAiCredits: 4000, advancedAnalytics: false }),
      expect.objectContaining({ planId: "pro", amountCents: 19900, platformFeeBps: 500, monthlyAiCredits: null, unlimitedAiCredits: true, advancedAnalytics: true }),
    ]);
  });

  it("flags advanced analytics for Pro sellers", async () => {
    state.planId = "pro";
    const body: any = await (await fetch(`${base}/api/seller/subscription/perks`)).json();
    expect(body.currentPlan).toBe("pro");
    expect(body.hasAdvancedAnalytics).toBe(true);
  });

  it("still returns the catalogue when the plan cannot be verified", async () => {
    state.fail = true;
    const res = await fetch(`${base}/api/seller/subscription/perks`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.currentPlan).toBeNull();
    expect(body.hasAdvancedAnalytics).toBe(false);
    expect(body.plans).toHaveLength(3);
  });
});

describe("GET /api/analytics/advanced", () => {
  it("is refused below Pro with an upgrade response", async () => {
    for (const plan of ["starter", "growth"]) {
      state.planId = plan;
      const res = await fetch(`${base}/api/analytics/advanced`);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "PLAN_REQUIRED", requiredPlan: "pro", currentPlan: plan });
    }
  });

  it("denies access when the plan cannot be verified", async () => {
    state.fail = true;
    expect((await fetch(`${base}/api/analytics/advanced`)).status).toBe(503);
  });

  it("returns cohorts, order value and lifetime value for Pro, ignoring cancelled orders", async () => {
    state.planId = "pro";
    const res = await fetch(`${base}/api/analytics/advanced`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.months).toHaveLength(6);
    const cohort = body.cohorts[5];
    expect(cohort).toMatchObject({ customers: 2, repeatCustomers: 1, repeatRate: 50, revenueCents: 15000 });
    expect(body.orderValue[5]).toMatchObject({ orders: 3, revenueCents: 15000, averageOrderCents: 5000 });
    expect(body.lifetime).toMatchObject({ customers: 2, revenueCents: 15000, averageLifetimeValueCents: 7500 });
    expect(body.cohorts[0]).toMatchObject({ customers: 0, repeatRate: 0 });
  });

  it("leaves existing basic analytics free", async () => {
    state.planId = "starter";
    const res = await fetch(`${base}/api/analytics/revenue`);
    expect(res.status).not.toBe(403);
  });
});
