/**
 * Wave-1 audit (slice s01) — routes/analytics.ts + routes/analytics-reports.ts
 *
 *  - /api/analytics/reports/* needs the analytics permission (same gate as
 *    /api/analytics/insights): a team member with the staff role can't read
 *    the store's profit / fees report.
 *  - GET /api/analytics/customers?limit=-5 is clamped (it used to reach
 *    Postgres as LIMIT -5 and 500).
 *  - Customer stats don't count all guest orders as one repeat "customer".
 *  - GET /api/analytics/advanced uses the file's one revenue definition:
 *    paid, not cancelled, net of refunds (unpaid orders were counted).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
import { eq } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const SELLER = `w1s01-an-seller-${sfx}`;

const state = vi.hoisted(() => ({ teamRole: null as null | string }));

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: `w1s01-an-actor-${process.env.W1S01_AN_SFX}` }) }));
vi.mock("../../middlewares/requireAuth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = `w1s01-an-seller-${process.env.W1S01_AN_SFX}`;
    // A resolved team context, as routes/index.ts's `tc` leaves it.
    if (state.teamRole) {
      req.teamContext = {
        actorClerkId: `w1s01-an-actor-${process.env.W1S01_AN_SFX}`,
        actorRole: state.teamRole,
        storeOwnerId: req.clerkUserId,
        teamMembershipId: null,
      };
    }
    next();
  },
}));
vi.mock("../../middlewares/featureGate", () => ({
  featureGate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";
let seq = 0;

async function order(values: Partial<typeof orders.$inferInsert>) {
  seq += 1;
  await db.insert(orders).values({
    ownerId: SELLER, orderNumber: `W1S01-${sfx}-${seq}`, status: "processing",
    totalCents: 1000, subtotalCents: 1000, paidAt: new Date(), ...values,
  });
}

beforeAll(async () => {
  process.env.W1S01_AN_SFX = sfx;
  const now = new Date();
  // buyer-a: two paid orders (one partly refunded) → repeat customer
  await order({ buyerId: `a-${sfx}`, totalCents: 4000, createdAt: now });
  await order({ buyerId: `a-${sfx}`, totalCents: 6000, refundedCents: 1000, createdAt: now });
  // buyer-b: one paid order
  await order({ buyerId: `b-${sfx}`, totalCents: 5000, createdAt: now });
  // buyer-c: never paid (authorized / abandoned) → not revenue, not a customer
  await order({ buyerId: `c-${sfx}`, totalCents: 9000, paidAt: null, createdAt: now });
  // three guest orders
  for (let i = 0; i < 3; i++) await order({ buyerId: null, guestEmail: `g${i}-${sfx}@test.local`, totalCents: 100, createdAt: now });

  const { default: analyticsRouter } = await import("../analytics");
  const { default: reportsRouter } = await import("../analytics-reports");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use("/api/analytics/reports", reportsRouter);
  app.use("/api/analytics", analyticsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.ownerId, SELLER));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { state.teamRole = null; });

describe("analytics reports permission", () => {
  it("refuses a staff team member (no analytics access)", async () => {
    state.teamRole = "staff";
    for (const r of ["store", "profit", "marketing", "production"]) {
      const res = await fetch(`${base}/api/analytics/reports/${r}?range=30d`);
      expect(`${r} ${res.status}`).toBe(`${r} 403`);
    }
  });

  it("allows a viewer (analytics access) and the owner", async () => {
    state.teamRole = "viewer";
    expect((await fetch(`${base}/api/analytics/reports/profit?range=30d`)).status).toBe(200);
    state.teamRole = null;
    expect((await fetch(`${base}/api/analytics/reports/profit?range=30d`)).status).toBe(200);
  });
});

describe("GET /api/analytics/customers", () => {
  it("clamps a negative limit instead of failing", async () => {
    const res = await fetch(`${base}/api/analytics/customers?limit=-5`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.topCustomers.length).toBeGreaterThanOrEqual(1);
  });

  it("does not count guest orders as one repeat customer", async () => {
    const body: any = await (await fetch(`${base}/api/analytics/customers`)).json();
    // Signed-in paying buyers: a (2 orders) and b (1 order).
    expect(body.stats).toMatchObject({ totalCustomers: 2, repeatCustomers: 1, repeatRate: 50, avgOrdersPerCustomer: 1.5 });
  });
});

describe("GET /api/analytics/advanced", () => {
  it("counts only paid orders, net of refunds", async () => {
    const res = await fetch(`${base}/api/analytics/advanced`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // Paid buyer orders: 4000 + (6000 − 1000) + 5000 = 14000; guests (300) have no buyer.
    expect(body.lifetime).toMatchObject({ customers: 2, revenueCents: 14_000, averageLifetimeValueCents: 7_000 });
    expect(body.cohorts[5]).toMatchObject({ customers: 2, repeatCustomers: 1, revenueCents: 14_000 });
    // Month view includes paid guest orders: 14000 + 300, over 6 paid orders.
    expect(body.orderValue[5]).toMatchObject({ orders: 6, revenueCents: 14_300 });
  });
});
