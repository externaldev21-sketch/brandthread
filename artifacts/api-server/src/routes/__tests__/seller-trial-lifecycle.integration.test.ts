/**
 * Dev's trial decision, server side: cancel / resume (Settings → Plan), the
 * fields the plan screen reads from /status, and one free trial per person,
 * device and card. Real Postgres; Stripe is a small fake.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { db, notificationsFeed, sellerSubscriptionEntitlements, sellerTrialClaims, users } from "@workspace/db";

const suffix = crypto.randomBytes(5).toString("hex");
const stripeSeller = `trial-stripe-${suffix}`;
const nativeSeller = `trial-native-${suffix}`;
const freshSeller = `trial-fresh-${suffix}`;
const otherSeller = `trial-other-${suffix}`;
const everyone = [stripeSeller, nativeSeller, freshSeller, otherSeller];

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);

const fake = vi.hoisted(() => ({
  subs: new Map<string, any>(),
  updates: [] as Array<{ id: string; params: any }>,
  cancelled: [] as string[],
  sessions: [] as any[],
  cards: new Map<string, string>(),
}));

vi.mock("../../lib/stripe", () => {
  const client = {
    subscriptions: {
      retrieve: async (id: string) => {
        const sub = fake.subs.get(id);
        if (!sub) throw Object.assign(new Error("No such subscription"), { status: 404 });
        return sub;
      },
      update: async (id: string, params: any) => {
        fake.updates.push({ id, params });
        const sub = { ...fake.subs.get(id), ...params };
        fake.subs.set(id, sub);
        return sub;
      },
      cancel: async (id: string) => {
        fake.cancelled.push(id);
        return { id, status: "canceled" };
      },
    },
    paymentMethods: { retrieve: async (id: string) => ({ id, card: { fingerprint: fake.cards.get(id) } }) },
    prices: {
      list: async () => ({ data: [] }),
      create: async (p: any) => ({ id: `price_${p.lookup_key}` }),
    },
    customers: { create: async () => ({ id: `cus_${crypto.randomUUID()}` }) },
    checkout: {
      sessions: {
        create: async (params: any) => {
          fake.sessions.push(params);
          return { url: "https://checkout.stripe.test/s" };
        },
      },
    },
  };
  return { stripe: client, requireStripe: () => client };
});
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

let server: Server;
let base = "";

async function call(path: string, user: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/seller/subscription${path}`, {
    method,
    headers: { "x-test-user": user, ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeAll(async () => {
  await db.insert(users).values(everyone.map((clerkId) => ({
    clerkId, email: `${clerkId}@trial.invalid`, name: clerkId, role: "seller", accountType: "seller",
  })));
  const { default: router } = await import("../subscription");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/subscription", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(sellerTrialClaims).where(inArray(sellerTrialClaims.clerkId, everyone));
  await db.delete(sellerSubscriptionEntitlements).where(inArray(sellerSubscriptionEntitlements.clerkUserId, everyone));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, everyone));
  await db.delete(users).where(inArray(users.clerkId, everyone));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  fake.updates.length = 0;
  fake.cancelled.length = 0;
  fake.sessions.length = 0;
});

describe("Cancel plan / resubscribe (Stripe)", () => {
  const subId = `sub_trial_${suffix}`;
  // Day 5 of a 7-day trial: the reminder day.
  const trialStart = now - 4.5 * DAY;
  const trialEnd = trialStart + 7 * DAY;

  beforeAll(async () => {
    fake.subs.set(subId, {
      id: subId, status: "trialing", trial_start: trialStart, trial_end: trialEnd,
      current_period_end: trialEnd, cancel_at_period_end: false, items: { data: [{ id: "si_1" }] },
    });
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({
      subscriptionId: subId, subscriptionStatus: "trialing", subscriptionPlanId: "starter",
      subscriptionTrialStartedAt: new Date(trialStart * 1000), subscriptionTrialEndsAt: new Date(trialEnd * 1000),
    }).where(eq(users.clerkId, stripeSeller));
  });

  it("cancelling in the trial sets cancel_at_period_end: no charge, access until the trial ends", async () => {
    const before = await call("/status", stripeSeller);
    expect(before.body.trialBanner?.message).toMatch(/^Your Starter plan starts on .+ at \$19\.99\/month\. Cancel anytime before then and you won't be charged\.$/);
    const res = await call("/cancel", stripeSeller, "POST");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelAtPeriodEnd: true, inTrial: true, accessEndsAt: new Date(trialEnd * 1000).toISOString() });
    expect(fake.updates).toEqual([{ id: subId, params: { cancel_at_period_end: true } }]);

    const status = await call("/status", stripeSeller);
    expect(status.body).toMatchObject({
      status: "trialing", cancelAtPeriodEnd: true, accessEndsAt: new Date(trialEnd * 1000).toISOString(),
      trialEligible: false,
    });
    expect(status.body.manageUrl).toMatch(/\/subscription$/);
    // A cancelled trial won't be charged, so the "trial ends" banner is gone.
    expect(status.body.trialBanner).toBeNull();
  });

  it("one tap resumes it while access lasts", async () => {
    const res = await call("/resume", stripeSeller, "POST");
    expect(res.status).toBe(200);
    expect(fake.updates).toEqual([{ id: subId, params: { cancel_at_period_end: false } }]);
    expect((await call("/status", stripeSeller)).body.cancelAtPeriodEnd).toBe(false);
  });

  it("picking a plan while a cancellation is pending also re-subscribes", async () => {
    await call("/cancel", stripeSeller, "POST");
    fake.updates.length = 0;
    const res = await call("/checkout", stripeSeller, "POST", { planId: "growth" });
    expect(res.body.updated).toBe(true);
    expect(fake.updates[0].params).toMatchObject({ cancel_at_period_end: false });
  });

  it("once the plan has ended, resume asks the seller to pick a plan", async () => {
    fake.subs.set(subId, { ...fake.subs.get(subId), status: "canceled" });
    const res = await call("/resume", stripeSeller, "POST");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RESUBSCRIBE_REQUIRED");
  });
});

describe("Cancel plan (in-app purchase)", () => {
  beforeAll(async () => {
    await db.insert(sellerSubscriptionEntitlements).values({
      clerkUserId: nativeSeller, provider: "revenuecat", planId: "growth", status: "trial",
      expiresAt: new Date((now + 2 * DAY) * 1000), trialEndsAt: new Date((now + 2 * DAY) * 1000),
      productIdentifier: "brandthread_growth_monthly",
      providerData: { items: [{ status: "trialing", store: "play_store", auto_renewal_status: "will_renew" }] },
    });
  });

  it("sends the seller to the store's subscription page", async () => {
    const res = await call("/cancel", nativeSeller, "POST");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "MANAGE_IN_STORE", manageUrl: "https://play.google.com/store/account/subscriptions" });
    expect(fake.updates).toHaveLength(0);
  });

  it("status shows the store link, and the end date once cancelled in the store", async () => {
    let status = await call("/status", nativeSeller);
    expect(status.body).toMatchObject({ effectiveProvider: "revenuecat", cancelAtPeriodEnd: false, manageUrl: "https://play.google.com/store/account/subscriptions" });
    const { eq } = await import("drizzle-orm");
    await db.update(sellerSubscriptionEntitlements).set({
      providerData: { items: [{ status: "trialing", store: "app_store", auto_renewal_status: "will_not_renew", management_url: "https://apps.apple.com/account/subscriptions" }] },
    }).where(eq(sellerSubscriptionEntitlements.clerkUserId, nativeSeller));
    status = await call("/status", nativeSeller);
    expect(status.body.cancelAtPeriodEnd).toBe(true);
    expect(status.body.accessEndsAt).toBe(new Date((now + 2 * DAY) * 1000).toISOString());
  });
});

describe("one free trial per person, device and card", () => {
  it("a first-time seller gets the trial at checkout", async () => {
    expect((await call("/status", freshSeller)).body.trialEligible).toBe(true);
    const res = await call("/checkout", freshSeller, "POST", { planId: "starter" }, { "x-bt-install-id": `install-${suffix}` });
    expect(res.body.trial).toBe(true);
    expect(fake.sessions[0].subscription_data).toMatchObject({ trial_period_days: 7, metadata: { installId: `install-${suffix}` } });
    expect(fake.sessions[0].payment_method_collection).toBe("always");
  });

  it("an account that already trialed (here: in the app) checks out without a trial", async () => {
    const res = await call("/checkout", nativeSeller, "POST", { planId: "starter" });
    expect(res.body.trial).toBe(false);
    expect(fake.sessions[0].subscription_data.trial_period_days).toBeUndefined();
    expect(fake.sessions[0].success_url).toContain("trial=0");
  });

  it("a second account on a device that already trialed gets no trial", async () => {
    const { recordTrialClaim } = await import("../../lib/sellerTrial");
    await recordTrialClaim({ clerkId: freshSeller, provider: "stripe", subscriptionRef: `sub_fresh_${suffix}`, installId: `install-${suffix}` });
    const res = await call("/checkout", otherSeller, "POST", { planId: "starter" }, { "x-bt-install-id": `install-${suffix}` });
    expect(res.body.trial).toBe(false);
    // The same account on a new device is still covered by the person rule.
    expect((await call("/status", freshSeller, "GET", undefined, { "x-bt-install-id": `new-device-${suffix}` })).body.trialEligible).toBe(false);
  });

  it("a trial on a card another account already trialed with is cancelled before any charge", async () => {
    const { checkStripeTrial } = await import("../../lib/sellerTrial");
    const { stripe } = await import("../../lib/stripe");
    fake.cards.set(`pm_fresh_${suffix}`, `fp_${suffix}`);
    fake.cards.set(`pm_other_${suffix}`, `fp_${suffix}`);
    const freshSub = { id: `sub_card_a_${suffix}`, status: "trialing", default_payment_method: `pm_fresh_${suffix}`, metadata: {} };
    expect(await checkStripeTrial(stripe as any, freshSub, freshSeller)).toBe("recorded");
    expect(await checkStripeTrial(stripe as any, freshSub, freshSeller)).toBe("already_recorded");

    const reusedSub = { id: `sub_card_b_${suffix}`, status: "trialing", default_payment_method: `pm_other_${suffix}`, metadata: {} };
    expect(await checkStripeTrial(stripe as any, reusedSub, otherSeller)).toBe("card_reused");
    expect(fake.cancelled).toEqual([reusedSub.id]);
    const { eq } = await import("drizzle-orm");
    const notices = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, otherSeller));
    expect(notices.map((n) => n.type)).toContain("subscription_trial_card_reused");
    // A replayed webhook doesn't cancel twice.
    expect(await checkStripeTrial(stripe as any, reusedSub, otherSeller)).toBe("already_recorded");
    expect(fake.cancelled).toHaveLength(1);
    // The same person reusing their own card is not blocked by the card rule.
    const ownSub = { id: `sub_card_c_${suffix}`, status: "trialing", default_payment_method: `pm_fresh_${suffix}`, metadata: {} };
    expect(await checkStripeTrial(stripe as any, ownSub, freshSeller)).toBe("recorded");
  });
});

describe("helpers", () => {
  it("reads store details from the RevenueCat record and picks the right manage link", async () => {
    const { manageUrlFor, nativeSubscriptionDetails, installIdFrom } = await import("../../lib/sellerTrial");
    expect(nativeSubscriptionDetails(null)).toEqual({ store: null, willRenew: null, managementUrl: null });
    expect(manageUrlFor("revenuecat", { store: "app_store", willRenew: true, managementUrl: null })).toBe("https://apps.apple.com/account/subscriptions");
    expect(manageUrlFor("revenuecat", nativeSubscriptionDetails({ providerData: { items: [{ store: "play_store", management_url: "javascript:alert(1)" }] } })))
      .toBe("https://play.google.com/store/account/subscriptions");
    const header = (value: string | undefined) => ({ header: () => value }) as any;
    expect(installIdFrom(header("abc"))).toBeNull();
    expect(installIdFrom(header("a1b2c3d4-e5f6"))).toBe("a1b2c3d4-e5f6");
    expect(installIdFrom(header("bad id with spaces"))).toBeNull();
  });
});
