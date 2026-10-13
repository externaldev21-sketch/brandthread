/**
 * Items 115 + 116 over real HTTP and a real Postgres:
 *  - Stripe webhooks (real signature verification, the money tests' fake
 *    Stripe): invoice.payment_failed attempts 1–3 notify "retry N of 3",
 *    attempt 4 pauses the plan (pause_collection void + dunningPausedAt) and
 *    restricts paid features; replays never notify or pause twice; a card
 *    update charges the open invoice; invoice.paid resumes the plan.
 *  - POST /api/seller/subscription/checkout interval validation and annual
 *    Stripe Prices (brandthread_<plan>_annual, 10 × monthly, interval year).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  push: [] as Array<{ userId: string; title: string; body: string }>,
  email: [] as Array<{ to: string; subject: string; idempotencyKey?: string }>,
  subscriptionUpdates: [] as Array<{ id: string; params: any; options: any }>,
  invoicePays: [] as string[],
  prices: [] as any[],
  subscriptions: new Map<string, any>(),
}));

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../lib/money/__tests__/fakeStripe");
  const stripe = fake.stripe as any;
  stripe.subscriptions = {
    retrieve: async (id: string) => {
      const sub = calls.subscriptions.get(id);
      if (!sub) throw Object.assign(new Error("No such subscription"), { statusCode: 404 });
      return sub;
    },
    update: async (id: string, params: any, options: any) => {
      calls.subscriptionUpdates.push({ id, params, options });
      const sub = calls.subscriptions.get(id) ?? { id };
      calls.subscriptions.set(id, { ...sub, ...params, metadata: { ...(sub.metadata ?? {}), ...(params.metadata ?? {}) } });
      return calls.subscriptions.get(id);
    },
  };
  stripe.invoices = {
    pay: async (id: string) => { calls.invoicePays.push(id); return { id, status: "paid" }; },
    list: async () => ({ data: [] }),
  };
  stripe.prices = {
    list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({ data: calls.prices.filter((p) => lookup_keys.includes(p.lookup_key)) }),
    create: async (params: any) => {
      const price = { id: `price_${calls.prices.length + 1}`, ...params };
      calls.prices.push(price);
      return price;
    },
  };
  return { ...actual, stripe, requireStripe: () => stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../lib/push", () => ({
  normalizePushEventCategory: () => "system",
  sendPushToUser: async (userId: string, payload: { title: string; body: string }) => {
    calls.push.push({ userId, title: payload.title, body: payload.body });
  },
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../lib/brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/brandthreadEmail")>()),
  sendBrandthreadEmail: async (opts: { to: string; subject: string; idempotencyKey?: string }) => {
    calls.email.push(opts);
    return true;
  },
}));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "billing-test-user" }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireRole")>();
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, teamContext: pass, requireRole: pass };
});

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, notificationsFeed, sellerSubscriptionDunning, users } from "@workspace/db";
import { fake } from "../../lib/money/__tests__/fakeStripe";
import { getEffectiveEntitlement } from "../../lib/nativeEntitlements";

const suffix = crypto.randomBytes(5).toString("hex");
const sellerId = `billing-dunning-${suffix}`;
const customerId = `cus_dunning_${suffix}`;
const subscriptionId = `sub_dunning_${suffix}`;
const invoiceId = `in_dunning_${suffix}`;
const originalKey = process.env.STRIPE_SECRET_KEY;

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  const { default: webhooksRouter } = await import("../webhooks");
  const { default: subscriptionRouter } = await import("../subscription");
  const app = express();
  app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api/webhooks", webhooksRouter);
  app.use("/api/seller/subscription", subscriptionRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, sellerId));
  await db.delete(sellerSubscriptionDunning).where(eq(sellerSubscriptionDunning.clerkUserId, sellerId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  calls.push.length = 0;
  calls.email.length = 0;
  calls.subscriptionUpdates.length = 0;
  calls.invoicePays.length = 0;
});

let eventCounter = 0;
async function deliver(type: string, object: Record<string, unknown>, extra: Record<string, unknown> = {}, eventId?: string) {
  const event = {
    id: eventId ?? `evt_dunning_${suffix}_${++eventCounter}`,
    object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000),
    data: { object, ...extra },
  };
  const { payload, header } = fake.signedEvent(event);
  const response = await fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  return { status: response.status, body: await response.json().catch(() => null), id: event.id };
}

const DAY = 86_400;
function failedInvoice(attempt: number, next: number | null) {
  return {
    id: invoiceId, object: "invoice", customer: customerId, status: "open",
    // API ≥ 2025-03-31 shape (the legacy invoice.subscription is covered too).
    parent: { subscription_details: { subscription: subscriptionId, metadata: {} } },
    attempt_count: attempt, next_payment_attempt: next,
  };
}

async function dunningRow() {
  const [row] = await db.select().from(sellerSubscriptionDunning).where(eq(sellerSubscriptionDunning.clerkUserId, sellerId));
  return row;
}

describe("dunning: 3 retries, then pause; resume on payment", () => {
  it("runs the whole sequence", async () => {
    await db.insert(users).values({
      clerkId: sellerId, email: `${sellerId}@test.invalid`, name: "Dunning seller", role: "seller", accountType: "seller",
      stripeCustomerId: customerId, subscriptionId, subscriptionStatus: "past_due", subscriptionPlanId: "growth",
    });
    calls.subscriptions.set(subscriptionId, {
      id: subscriptionId, customer: customerId, status: "past_due", metadata: { clerkUserId: sellerId },
      items: { data: [{ id: "si_1", price: { lookup_key: "brandthread_growth_monthly", recurring: { interval: "month" } } }] },
    });
    const now = Math.floor(Date.now() / 1000);

    // Attempts 1–3: one notice each, with the retry number and date.
    for (const attempt of [1, 2, 3]) {
      const result = await deliver("invoice.payment_failed", failedInvoice(attempt, now + attempt * 3 * DAY));
      expect(result.status).toBe(200);
      expect(calls.push).toHaveLength(attempt);
      expect(calls.push[attempt - 1].body).toContain(`(retry ${attempt} of 3)`);
    }
    expect(calls.email.map((e) => e.idempotencyKey)).toEqual([1, 2, 3].map((n) => `dunning/${invoiceId}/${n}`));
    expect(calls.subscriptionUpdates).toHaveLength(0);
    expect((await dunningRow()).lastAttempt).toBe(3);

    // Still entitled while Stripe is retrying (past_due).
    expect((await getEffectiveEntitlement(sellerId)).planId).toBe("growth");

    // Same attempt redelivered under a new event id (e.g. resent from the
    // Dashboard): no second notice.
    await deliver("invoice.payment_failed", failedInvoice(3, now + 9 * DAY));
    expect(calls.push).toHaveLength(3);

    const status = await fetch(`${base}/api/seller/subscription/status`, { headers: { "x-test-user": sellerId } }).then((r) => r.json() as Promise<any>);
    expect(status.dunning).toMatchObject({ state: "retrying", retryNumber: 3, maxRetries: 3 });

    // Attempt 4 = the 3rd retry failed → pause.
    calls.push.length = 0;
    const pause = await deliver("invoice.payment_failed", failedInvoice(4, null));
    expect(pause.status).toBe(200);
    expect(calls.subscriptionUpdates).toHaveLength(1);
    expect(calls.subscriptionUpdates[0].params.pause_collection).toEqual({ behavior: "void" });
    expect(calls.subscriptionUpdates[0].params.metadata.dunningPausedAt).toBeTruthy();
    expect(calls.push.map((p) => p.title)).toEqual(["Plan paused"]);
    const [paused] = await db.select({ status: users.subscriptionStatus }).from(users).where(eq(users.clerkId, sellerId));
    expect(paused.status).toBe("paused");
    // Restricted like a cancelled plan.
    expect(await getEffectiveEntitlement(sellerId)).toMatchObject({ planId: "starter", provider: "none" });

    // Stripe's subscription.updated after the pause keeps "paused".
    await deliver("customer.subscription.updated", calls.subscriptions.get(subscriptionId));
    const [stillPaused] = await db.select({ status: users.subscriptionStatus }).from(users).where(eq(users.clerkId, sellerId));
    expect(stillPaused.status).toBe("paused");

    // Replay of the pausing event and a later failure: nothing more happens.
    calls.push.length = 0;
    await deliver("invoice.payment_failed", failedInvoice(4, null), {}, pause.id);
    await deliver("invoice.payment_failed", failedInvoice(5, null));
    expect(calls.subscriptionUpdates).toHaveLength(1);
    expect(calls.push).toHaveLength(0);

    const pausedStatus = await fetch(`${base}/api/seller/subscription/status`, { headers: { "x-test-user": sellerId } }).then((r) => r.json() as Promise<any>);
    expect(pausedStatus.status).toBe("paused");
    expect(pausedStatus.dunning).toMatchObject({ state: "paused", maxRetries: 3 });

    // New default card → we charge the open invoice.
    await deliver("customer.updated", { id: customerId, object: "customer", invoice_settings: { default_payment_method: "pm_new" } },
      { previous_attributes: { invoice_settings: { default_payment_method: "pm_old" } } });
    expect(calls.invoicePays).toEqual([invoiceId]);

    // invoice.paid → resume + restore.
    await deliver("invoice.paid", { id: invoiceId, object: "invoice", customer: customerId, subscription: subscriptionId, status: "paid" });
    const resume = calls.subscriptionUpdates.at(-1)!;
    expect(resume.params).toEqual({ pause_collection: "", metadata: { dunningPausedAt: "" } });
    expect(calls.push.map((p) => p.title)).toEqual(["Plan resumed"]);
    expect(await getEffectiveEntitlement(sellerId)).toMatchObject({ planId: "growth", provider: "stripe" });
    expect(await dunningRow()).toMatchObject({ lastAttempt: 0, pausedAt: null, invoiceId: null });

    // Replayed invoice.paid: no second resume.
    const updatesBefore = calls.subscriptionUpdates.length;
    await deliver("invoice.paid", { id: invoiceId, object: "invoice", customer: customerId, subscription: subscriptionId, status: "paid" });
    expect(calls.subscriptionUpdates).toHaveLength(updatesBefore);

    const feed = await db.select({ type: notificationsFeed.type }).from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, sellerId), inArray(notificationsFeed.type, [
        "subscription_payment_failed", "subscription_plan_paused", "subscription_plan_resumed",
      ])));
    expect(feed.map((f) => f.type).sort()).toEqual([
      "subscription_payment_failed", "subscription_payment_failed", "subscription_payment_failed",
      "subscription_plan_paused", "subscription_plan_resumed",
    ]);
  });
});

describe("annual checkout", () => {
  async function checkout(body: Record<string, unknown>) {
    const response = await fetch(`${base}/api/seller/subscription/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": sellerId },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  it("refuses a new checkout while the plan is past due or paused (no second subscription)", async () => {
    const sub = calls.subscriptions.get(subscriptionId);
    const states = [
      { ...sub, status: "past_due", pause_collection: null, metadata: {} },
      { ...sub, status: "past_due", pause_collection: { behavior: "void" }, metadata: { dunningPausedAt: "2026-10-13T00:00:00Z" } },
      { ...sub, status: "unpaid", pause_collection: null, metadata: {} },
    ];
    for (const state of states) {
      calls.subscriptions.set(subscriptionId, state);
      const createsBefore = fake.state.checkoutSessionCreates.length;
      const updatesBefore = calls.subscriptionUpdates.length;
      for (const body of [{ planId: "pro" }, { planId: "growth", interval: "year" }]) {
        const result = await checkout(body);
        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({ code: "SUBSCRIPTION_NEEDS_PAYMENT_UPDATE", message: "Update your card to restore your plan." });
      }
      expect(fake.state.checkoutSessionCreates.length).toBe(createsBefore);
      expect(calls.subscriptionUpdates.length).toBe(updatesBefore);
    }
  });

  it("rejects an unknown interval", async () => {
    const result = await checkout({ planId: "growth", interval: "weekly" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/interval/);
  });

  it("switches an active monthly plan to yearly in place, prorated, on a $790/yr price", async () => {
    calls.subscriptions.set(subscriptionId, { ...calls.subscriptions.get(subscriptionId), status: "active", pause_collection: null, metadata: {} });
    const result = await checkout({ planId: "growth", interval: "year" });
    expect(result.status).toBe(200);
    expect(result.body.updated).toBe(true);
    const price = calls.prices.find((p) => p.lookup_key === "brandthread_growth_annual");
    expect(price).toMatchObject({ unit_amount: 79_000, recurring: { interval: "year" } });
    const update = calls.subscriptionUpdates.at(-1)!;
    expect(update.params.items[0].price).toBe(price.id);
    expect(update.params.proration_behavior).toBe("create_prorations");
  });

  it("defaults to monthly", async () => {
    const result = await checkout({ planId: "pro" });
    expect(result.status).toBe(200);
    expect(calls.prices.find((p) => p.lookup_key === "brandthread_pro_199_monthly")).toMatchObject({
      unit_amount: 19_900, recurring: { interval: "month" },
    });
  });
});
