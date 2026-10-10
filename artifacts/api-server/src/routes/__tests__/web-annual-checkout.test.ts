/**
 * Web-only yearly prices: POST /api/seller/subscription/checkout with
 * { billing: "annual" } and the public GET /api/public/web-annual-plans.
 * Monthly checkout must stay exactly as before.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const fake = vi.hoisted(() => {
  const state = {
    sessions: [] as any[],
    prices: {} as Record<string, any>,
    priceUpdates: [] as any[],
  };
  const stripe = {
    prices: {
      retrieve: async (id: string) => {
        if (!state.prices[id]) throw new Error("No such price");
        return state.prices[id];
      },
      update: async (id: string, params: any) => { state.priceUpdates.push([id, params]); return { ...state.prices[id], ...params }; },
      list: async () => ({ data: [{ id: "price_monthly_growth", unit_amount: 7900 }] }),
      create: async () => ({ id: "price_created" }),
    },
    customers: { create: async () => ({ id: "cus_new" }) },
    subscriptions: { retrieve: async () => null },
    checkout: { sessions: { create: async (params: any) => { state.sessions.push(params); return { url: "https://checkout.stripe.test/s" }; } } },
  };
  return { state, stripe };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = "seller_1"; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/stripe", () => ({ stripe: fake.stripe, requireStripe: () => fake.stripe }));
vi.mock("../../lib/nativeEntitlements", () => ({ getEffectiveEntitlement: vi.fn(), reconcileRevenueCatEntitlement: vi.fn() }));
vi.mock("../../jobs/sellerTrialReminder", () => ({ isDayFourOfFive: () => false }));
vi.mock("drizzle-orm", () => ({ eq: (...v: unknown[]) => v, and: (...v: unknown[]) => v, desc: (v: unknown) => v }));
vi.mock("@workspace/db", () => {
  const columns = new Proxy({}, { get: (_t, key) => String(key) });
  const row = { subscriptionId: null, stripeCustomerId: "cus_1", email: "s@example.com", name: "Seller" };
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
    users: columns,
  };
});

import subscriptionRouter from "../subscription";
import { publicWebAnnualPlansRouter } from "../web-annual-plans";
import { resetWebAnnualCache } from "../../lib/webAnnualPrices";

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/seller/subscription", subscriptionRouter);
  app.use("/api/public", publicWebAnnualPlansRouter);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  fake.state.sessions = [];
  fake.state.priceUpdates = [];
  fake.state.prices = {};
  delete process.env.STRIPE_PRICE_GROWTH_ANNUAL_WEB;
  resetWebAnnualCache();
});

const checkout = (body: unknown) =>
  fetch(`${base}/api/seller/subscription/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("checkout billing", () => {
  it("monthly checkout is unchanged", async () => {
    const res = await checkout({ planId: "growth" });
    expect(res.status).toBe(200);
    expect(fake.state.sessions[0].line_items).toEqual([{ price: "price_monthly_growth", quantity: 1 }]);
    expect(fake.state.sessions[0].payment_method_collection).toBe("always");
  });

  it("refuses yearly billing when no yearly web price is configured", async () => {
    const res = await checkout({ planId: "growth", billing: "annual" });
    expect(res.status).toBe(400);
    expect(fake.state.sessions).toHaveLength(0);
  });

  it("uses the configured yearly web price with the same trial and card collection", async () => {
    process.env.STRIPE_PRICE_GROWTH_ANNUAL_WEB = "price_growth_year";
    fake.state.prices.price_growth_year = {
      id: "price_growth_year", active: true, currency: "usd", unit_amount: 1, lookup_key: null,
      recurring: { interval: "year", interval_count: 1 },
    };
    const res = await checkout({ planId: "growth", billing: "annual" });
    expect(res.status).toBe(200);
    const session = fake.state.sessions[0];
    expect(session.line_items).toEqual([{ price: "price_growth_year", quantity: 1 }]);
    expect(session.payment_method_collection).toBe("always");
    expect(session.subscription_data.trial_period_days).toBeGreaterThan(0);
    expect(fake.state.priceUpdates).toEqual([["price_growth_year", { lookup_key: "brandthread_growth_annual_web", transfer_lookup_key: true }]]);
  });
});

describe("GET /api/public/web-annual-plans", () => {
  it("is empty and never calls Stripe until a price is configured", async () => {
    const res = await fetch(`${base}/api/public/web-annual-plans`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plans: [] });
  });

  it("lists the configured yearly price with Stripe's amount", async () => {
    process.env.STRIPE_PRICE_GROWTH_ANNUAL_WEB = "price_growth_year";
    fake.state.prices.price_growth_year = {
      id: "price_growth_year", active: true, currency: "usd", unit_amount: 4242, lookup_key: "brandthread_growth_annual_web",
      recurring: { interval: "year", interval_count: 1 },
    };
    const res = await fetch(`${base}/api/public/web-annual-plans`);
    expect(await res.json()).toEqual({ plans: [{ planId: "growth", amountCents: 4242 }] });
  });
});
