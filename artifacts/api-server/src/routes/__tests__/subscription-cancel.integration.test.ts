/**
 * In-app plan cancellation: POST /api/seller/subscription/cancel and /resume
 * flip Stripe's cancel_at_period_end (the plan keeps working until the paid
 * period ends), and /status reports it. App Store / Play plans are refused.
 */
import crypto from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({
  provider: "stripe" as "stripe" | "revenuecat" | "none",
  subs: new Map<string, any>(),
  updates: [] as Array<{ id: string; params: any }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/nativeEntitlements", () => ({
  getEffectiveEntitlement: async () => ({ provider: state.provider, planId: "growth", status: "active", native: null }),
  reconcileRevenueCatEntitlement: async () => undefined,
}));
vi.mock("../../lib/stripe", async (orig) => {
  const fakeStripe = {
    subscriptions: {
      retrieve: async (id: string) => {
        const sub = state.subs.get(id);
        if (!sub) throw Object.assign(new Error("No such subscription"), { status: 404 });
        return sub;
      },
      update: async (id: string, params: any) => {
        state.updates.push({ id, params });
        const next = { ...state.subs.get(id), ...params };
        state.subs.set(id, next);
        return next;
      },
    },
  };
  return { ...(await orig<typeof import("../../lib/stripe")>()), requireStripe: () => fakeStripe };
});

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `sub-cancel-${suffix}`;
const noPlan = `sub-cancel-none-${suffix}`;
const subId = `sub_cancel_${suffix}`;
const periodEnd = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
let server: Server;
let base = "";

async function call(user: string, path: string, method = "GET", body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/seller/subscription${path}`, {
    method, headers: { "x-test-user": user, "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@example.test`, name: "Cancel Seller", role: "seller", accountType: "seller", subscriptionId: subId, subscriptionPlanId: "growth" },
    { clerkId: noPlan, email: `${noPlan}@example.test`, name: "No Plan Seller", role: "seller", accountType: "seller" },
  ]);
  const { default: router } = await import("../subscription");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/seller/subscription", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  state.provider = "stripe";
  state.updates.length = 0;
  state.subs.set(subId, {
    id: subId, status: "active", cancel_at_period_end: false, current_period_end: periodEnd,
    items: { data: [{ id: "si_1" }] }, metadata: { planId: "growth" }, default_payment_method: null,
  });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, seller));
  await db.delete(users).where(eq(users.clerkId, noPlan));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("seller subscription cancel / resume", () => {
  it("cancels at period end, shows it in status, and resumes", async () => {
    const cancelled = await call(seller, "/cancel", "POST");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ cancelAtPeriodEnd: true, endsAt: new Date(periodEnd * 1000).toISOString() });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].params).toMatchObject({ cancel_at_period_end: true });

    const status = await call(seller, "/status");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ plan: "growth", cancelAtPeriodEnd: true });

    const resumed = await call(seller, "/resume", "POST");
    expect(resumed.status).toBe(200);
    expect(resumed.body).toMatchObject({ cancelAtPeriodEnd: false, endsAt: null });
    expect(state.updates[1].params).toMatchObject({ cancel_at_period_end: false });
  });

  it("records the seller's main reason as Stripe cancellation feedback", async () => {
    const cancelled = await call(seller, "/cancel", "POST", { reason: "too_expensive", comment: "  Sales are slow  " });
    expect(cancelled.status).toBe(200);
    expect(state.updates[0].params).toMatchObject({
      cancel_at_period_end: true,
      cancellation_details: { feedback: "too_expensive", comment: "Sales are slow" },
      metadata: { cancelReason: "too_expensive" },
    });
    await call(seller, "/resume", "POST");
    expect(state.updates[1].params.cancellation_details).toBeUndefined();
    expect(state.updates[1].params.metadata.cancelReason).toBe("");
  });

  it("ignores an unknown reason instead of failing the cancel", async () => {
    const cancelled = await call(seller, "/cancel", "POST", { reason: "drop table", comment: "x" });
    expect(cancelled.status).toBe(200);
    expect(state.updates[0].params.cancellation_details).toBeUndefined();
    expect(state.updates[0].params.metadata.cancelReason).toBe("");
  });

  it("does not call Stripe again when already in the requested state", async () => {
    await call(seller, "/cancel", "POST");
    await call(seller, "/cancel", "POST");
    expect(state.updates).toHaveLength(1);
  });

  it("refuses sellers without a plan, ended plans and App Store plans", async () => {
    expect((await call(noPlan, "/cancel", "POST")).body.code).toBe("NO_SUBSCRIPTION");
    state.subs.set(subId, { ...state.subs.get(subId), status: "canceled" });
    expect((await call(seller, "/cancel", "POST")).body.code).toBe("SUBSCRIPTION_ENDED");
    state.provider = "revenuecat";
    const native = await call(seller, "/cancel", "POST");
    expect(native.status).toBe(409);
    expect(native.body.code).toBe("NATIVE_SUBSCRIPTION");
    expect(state.updates).toHaveLength(0);
  });
});
