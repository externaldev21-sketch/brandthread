/**
 * Seller subscription webhooks over real HTTP (real Stripe signature
 * verification via the money tests' fake Stripe) and a real Postgres:
 * out-of-order / superseded subscription events must not re-grant a dead
 * plan or downgrade a seller whose current subscription is live.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../lib/money/__tests__/fakeStripe");
  const stripe = fake.stripe as any;
  return { ...actual, stripe, requireStripe: () => stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../lib/planProductSync", () => ({ syncProductsToPlanSoon: () => {} }));

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { fake } from "../../lib/money/__tests__/fakeStripe";

const suffix = crypto.randomBytes(5).toString("hex");
const sellerId = `s14-sub-${suffix}`;
const customerId = `cus_s14_${suffix}`;
const oldSub = `sub_s14_old_${suffix}`;
const newSub = `sub_s14_new_${suffix}`;
const originalKey = process.env.STRIPE_SECRET_KEY;

let server: Server;
let base = "";
let counter = 0;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  const { default: webhooksRouter } = await import("../webhooks");
  const app = express();
  app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api/webhooks", webhooksRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await db.insert(users).values({
    clerkId: sellerId, email: `${sellerId}@test.invalid`, name: "S14 seller", role: "seller", accountType: "seller",
    stripeCustomerId: customerId, subscriptionId: newSub, subscriptionStatus: "active", subscriptionPlanId: "growth",
  });
});

afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function deliver(type: string, object: Record<string, unknown>) {
  const event = {
    id: `evt_s14_${suffix}_${++counter}`,
    object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000),
    data: { object },
  };
  const { payload, header } = fake.signedEvent(event);
  const response = await fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  return response.status;
}

async function seller() {
  const [row] = await db.select({
    subscriptionId: users.subscriptionId, status: users.subscriptionStatus, plan: users.subscriptionPlanId,
  }).from(users).where(eq(users.clerkId, sellerId));
  return row;
}

function sub(id: string, status: string, lookupKey = "brandthread_growth_monthly") {
  return {
    id, object: "subscription", customer: customerId, status, cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
    items: { data: [{ id: `si_${id}`, price: { lookup_key: lookupKey, recurring: { interval: "month" } } }] },
  };
}

describe("seller subscription webhooks: superseded and out-of-order events", () => {
  it("deleting a superseded subscription does not downgrade the seller's live plan", async () => {
    expect(await deliver("customer.subscription.deleted", sub(oldSub, "canceled"))).toBe(200);
    expect(await seller()).toMatchObject({ subscriptionId: newSub, status: "active", plan: "growth" });
  });

  it("a terminal update for a superseded subscription does not repoint subscription_id", async () => {
    expect(await deliver("customer.subscription.updated", sub(oldSub, "canceled"))).toBe(200);
    expect(await seller()).toMatchObject({ subscriptionId: newSub, status: "active" });
  });

  it("a late 'active' update after the current subscription was deleted does not re-grant it", async () => {
    expect(await deliver("customer.subscription.deleted", sub(newSub, "canceled"))).toBe(200);
    expect(await seller()).toMatchObject({ subscriptionId: newSub, status: "canceled", plan: "starter" });
    expect(await deliver("customer.subscription.updated", sub(newSub, "active", "brandthread_pro_199_monthly"))).toBe(200);
    expect(await seller()).toMatchObject({ status: "canceled", plan: "starter" });
  });

  it("a brand-new subscription after cancellation is still recorded", async () => {
    const third = `sub_s14_third_${suffix}`;
    expect(await deliver("customer.subscription.created", sub(third, "active", "brandthread_pro_199_monthly"))).toBe(200);
    expect(await seller()).toMatchObject({ subscriptionId: third, status: "active", plan: "pro" });
  });
});
