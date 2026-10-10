/**
 * AI credit packs: Stripe checkout amount integrity, verify idempotency,
 * RevenueCat consumable webhook idempotency, and the history endpoint.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { aiCreditAccounts, aiCreditLedger, aiCreditPurchases, db, revenueCatWebhookEvents } from "@workspace/db";
import { PLAN_CREDIT_POLICY } from "../../lib/aiCredits/catalogue";

const stripeState = vi.hoisted(() => ({ sessions: new Map<string, any>(), lastCreate: null as any }));
const stripeFake = vi.hoisted(() => ({
  checkout: {
    sessions: {
      create: vi.fn(async (params: any) => {
        const id = `cs_test_${Math.random().toString(36).slice(2, 12)}abc`;
        const s = {
          id, url: `https://checkout.stripe.com/${id}`, payment_status: "unpaid", currency: "usd",
          amount_total: params.line_items[0].price_data.unit_amount, metadata: params.metadata,
        };
        stripeState.sessions.set(id, s);
        stripeState.lastCreate = params;
        return s;
      }),
      retrieve: vi.fn(async (id: string) => stripeState.sessions.get(id)),
    },
  },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../lib/stripe", () => ({ requireStripe: () => stripeFake, stripe: null, STRIPE_WEBHOOK_SECRET: "" }));
vi.mock("../../lib/nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async (id: string) =>
    id.includes("-pro-") ? { planId: "pro", provider: "revenuecat" }
    : id.includes("-free-") ? { planId: "starter", provider: "none" }
    : { planId: "growth", provider: "stripe" }),
  reconcileRevenueCatEntitlement: vi.fn(async () => undefined),
}));

const tag = crypto.randomUUID().slice(0, 8);
const userA = `ai-credits-test-growth-a-${tag}`;
const userB = `ai-credits-test-growth-b-${tag}`;
const proUser = `ai-credits-test-pro-${tag}`;
const freeUser = `ai-credits-test-free-${tag}`;
const RC_AUTH = "Bearer test-rc-secret";
let server: Server;
let base = "";

async function call(method: string, path: string, opts: { user?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.user ? { "x-test-user": opts.user } : {}), ...opts.headers },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let parsed: any = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text.slice(0, 300); }
  return { status: res.status, body: parsed };
}
const balance = async (u: string) => (await call("GET", "/api/ai/credits", { user: u })).body.purchasedBalance as number;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.REVENUECAT_WEBHOOK_AUTHORIZATION = RC_AUTH;
  const { default: creditsRouter } = await import("../ai-credits");
  const { default: webhooksRouter } = await import("../webhooks");
  const app = express();
  const noop = () => {};
  app.use((req: any, _res, next) => { req.log = { warn: noop, error: noop, info: noop }; next(); });
  app.use("/api/webhooks", express.json(), webhooksRouter);
  app.use("/api/ai/credits", creditsRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const ids = [userA, userB, proUser, freeUser];
  await db.delete(aiCreditLedger).where(inArray(aiCreditLedger.clerkUserId, ids));
  await db.delete(aiCreditPurchases).where(inArray(aiCreditPurchases.clerkUserId, ids));
  await db.delete(aiCreditAccounts).where(inArray(aiCreditAccounts.clerkUserId, ids));
  await db.delete(revenueCatWebhookEvents).where(inArray(revenueCatWebhookEvents.appUserId, ids));
  await new Promise((r) => server.close(r));
});

const okReturn = "http://localhost:8081/ai-credits?paymentReturn=1";

describe("pack checkout", () => {
  it("charges the catalogue amount regardless of what the client sends", async () => {
    const r = await call("POST", "/api/ai/credits/packs/credits_1500/checkout", {
      user: userA, body: { returnUrl: okReturn, amountCents: 1, credits: 99999, amount: 1 },
    });
    expect(r.status).toBe(200);
    expect(stripeState.lastCreate.line_items[0].price_data.unit_amount).toBe(1499);
    expect(stripeState.lastCreate.metadata).toMatchObject({ kind: "ai_credits", packId: "credits_1500", clerkUserId: userA });
    expect(r.body.url).toContain("checkout.stripe.com");
  });

  it("rejects unknown packs and non-allowlisted return URLs", async () => {
    expect((await call("POST", "/api/ai/credits/packs/credits_nope/checkout", { user: userA, body: { returnUrl: okReturn } })).status).toBe(404);
    expect((await call("POST", "/api/ai/credits/packs/credits_500/checkout", { user: userA, body: { returnUrl: "https://evil.example/ai-credits?paymentReturn=1" } })).status).toBe(400);
    expect((await call("POST", "/api/ai/credits/packs/credits_500/checkout", { user: userA, body: { returnUrl: "brandthread://ai-credits/?paymentReturn=1" } })).status).toBe(200);
  });

  it("offers no packs and refuses checkout on Pro and on accounts without a plan", async () => {
    for (const user of [proUser, freeUser]) {
      const r = await call("POST", "/api/ai/credits/packs/credits_500/checkout", { user, body: { returnUrl: okReturn } });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("packs_unavailable");
      expect((await call("GET", "/api/ai/credits", { user })).body.packs).toEqual([]);
    }
    expect((await call("GET", "/api/ai/credits", { user: userA })).body.packs.map((p: any) => p.credits)).toEqual([500, 1500, 5000]);
  });

  it("gives Pro a finite balance with tool costs, like every plan", async () => {
    const r = (await call("GET", "/api/ai/credits", { user: proUser })).body;
    const allowance = PLAN_CREDIT_POLICY.pro.monthlyAllowance;
    expect(r).toMatchObject({ plan: "pro", unlimited: false, balance: allowance, monthlyAllowance: allowance, isLow: false, packs: [] });
    expect(r.tools.every((t: any) => Number.isInteger(t.cost) && t.cost > 0)).toBe(true);
    expect((await call("GET", "/api/ai/credits/history", { user: proUser })).body.entries.map((e: any) => e.kind)).toEqual(["monthly_grant"]);
  });

  it("answers 503 when Stripe is not configured", async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const r = await call("POST", "/api/ai/credits/packs/credits_500/checkout", { user: userA, body: { returnUrl: okReturn } });
    process.env.STRIPE_SECRET_KEY = key;
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("stripe_unavailable");
  });
});

describe("verify", () => {
  it("credits only after payment_status=paid, and only once", async () => {
    const before = await balance(userA);
    const created = await call("POST", "/api/ai/credits/packs/credits_500/checkout", { user: userA, body: { returnUrl: okReturn } });
    const sessionId = created.body.sessionId as string;

    const unpaid = await call("POST", "/api/ai/credits/purchases/verify", { user: userA, body: { sessionId } });
    expect(unpaid.status).toBe(402);
    expect(await balance(userA)).toBe(before);

    stripeState.sessions.get(sessionId).payment_status = "paid";
    const first = await call("POST", "/api/ai/credits/purchases/verify", { user: userA, body: { sessionId } });
    const second = await call("POST", "/api/ai/credits/purchases/verify", { user: userA, body: { sessionId } });
    expect(first.body).toMatchObject({ credited: true, newlyGranted: true, credits: 500 });
    expect(second.body).toMatchObject({ credited: true, newlyGranted: false });
    expect(await balance(userA)).toBe(before + 500);
  });

  it("refuses another user's session and a tampered amount", async () => {
    const created = await call("POST", "/api/ai/credits/packs/credits_500/checkout", { user: userA, body: { returnUrl: okReturn } });
    const s = stripeState.sessions.get(created.body.sessionId);
    s.payment_status = "paid";
    expect((await call("POST", "/api/ai/credits/purchases/verify", { user: userB, body: { sessionId: s.id } })).status).toBe(403);
    s.amount_total = 1;
    const r = await call("POST", "/api/ai/credits/purchases/verify", { user: userA, body: { sessionId: s.id } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("amount_mismatch");
  });

  it("webhook fulfilment is idempotent", async () => {
    const { fulfilCreditCheckoutSession } = await import("../../lib/aiCredits/purchases");
    const before = await balance(userB);
    const session = { id: `cs_test_hook${tag}`, metadata: { kind: "ai_credits", packId: "credits_5000", clerkUserId: userB },
      payment_status: "paid", amount_total: 4499, currency: "usd" } as any;
    expect(await fulfilCreditCheckoutSession(session)).toMatchObject({ ok: true, granted: true });
    expect(await fulfilCreditCheckoutSession(session)).toMatchObject({ ok: true, granted: false });
    expect(await balance(userB)).toBe(before + 5000);
  });
});

describe("RevenueCat consumable webhook", () => {
  const post = (event: any, auth = RC_AUTH) => call("POST", "/api/webhooks/revenuecat", { body: { event }, headers: { authorization: auth } });

  it("credits a NON_RENEWING_PURCHASE once per event id", async () => {
    const before = await balance(userB);
    const event = { id: `rc-evt-${tag}-1`, type: "NON_RENEWING_PURCHASE", app_user_id: userB, product_id: "brandthread_ai_credits_1500" };
    expect((await post(event)).body).toMatchObject({ received: true, credited: true });
    expect((await post(event)).body).toMatchObject({ received: true, duplicate: true });
    expect(await balance(userB)).toBe(before + 1500);
  });

  it("ignores unknown products and never credits unauthenticated calls", async () => {
    const before = await balance(userB);
    expect((await post({ id: `rc-evt-${tag}-2`, type: "NON_RENEWING_PURCHASE", app_user_id: userB, product_id: "brandthread_ai_credits_999" }))).toMatchObject({ status: 200 });
    expect((await post({ id: `rc-evt-${tag}-3`, type: "NON_RENEWING_PURCHASE", app_user_id: userB, product_id: "brandthread_ai_credits_500" }, "Bearer wrong")).status).toBe(401);
    expect(await balance(userB)).toBe(before);
  });
});

describe("history endpoint", () => {
  it("pages with the cursor, newest first, and includes purchases", async () => {
    const page1 = await call("GET", "/api/ai/credits/history?limit=2", { user: userB });
    expect(page1.status).toBe(200);
    expect(page1.body.entries).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await call("GET", `/api/ai/credits/history?limit=50&before=${encodeURIComponent(page1.body.nextCursor)}`, { user: userB });
    const ids = new Set(page1.body.entries.map((e: any) => e.id));
    expect(page2.body.entries.every((e: any) => !ids.has(e.id))).toBe(true);
    const all = [...page1.body.entries, ...page2.body.entries];
    expect(all.filter((e: any) => e.kind === "pack_purchase").length).toBeGreaterThanOrEqual(2);
    const times = all.map((e: any) => Date.parse(e.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("only returns the caller's own entries", async () => {
    const r = await call("GET", "/api/ai/credits/history", { user: `ai-credits-pack-nobody-${tag}` });
    expect(r.body.entries.every((e: any) => e.kind !== "pack_purchase")).toBe(true);
  });
});
