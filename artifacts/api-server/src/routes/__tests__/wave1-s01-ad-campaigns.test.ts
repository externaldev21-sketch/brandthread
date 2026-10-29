/**
 * Wave-1 audit (slice s01) — routes/ad-campaigns.ts
 *
 *  - A malformed campaign id is a 404, never a Postgres uuid-cast 500.
 *  - A malformed product CTA destination is a 422, never a 500.
 *  - PATCH can't change a campaign that a concurrent /pay moved to
 *    pending_payment (the Checkout Session is priced at the old budget).
 *  - /pay never persists a session whose amount no longer matches the
 *    campaign's budget (a PATCH landed while the session was being created).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { db, adCampaigns } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const hooks = vi.hoisted(() => ({
  /** Runs inside loadReachModel (PATCH, between its status read and its write). */
  onReach: null as null | (() => Promise<void>),
  /** Runs inside checkout.sessions.create (/pay, between its read and its persist). */
  onCreate: null as null | (() => Promise<void>),
}));

const fakeStripe = vi.hoisted(() => {
  const sessions = new Map<string, any>();
  const creates: { params: any; key?: string }[] = [];
  const expired: string[] = [];
  const fake = {
    checkout: {
      sessions: {
        create: async (params: any, opts?: { idempotencyKey?: string }) => {
          if (hooks.onCreate) { const h = hooks.onCreate; hooks.onCreate = null; await h(); }
          const prior = [...sessions.values()].find((s) => opts?.idempotencyKey && s.__key === opts.idempotencyKey);
          if (prior) return prior;
          const session = {
            id: `cs_test_w1s01_${Date.now()}_${creates.length + 1}`,
            url: `https://checkout.stripe.test/pay/${creates.length + 1}`,
            status: "open", payment_status: "unpaid",
            metadata: params.metadata ?? {},
            amount_total: params.line_items?.[0]?.price_data?.unit_amount,
            payment_intent: null,
            __key: opts?.idempotencyKey,
          };
          sessions.set(session.id, session);
          creates.push({ params, key: opts?.idempotencyKey });
          return session;
        },
        retrieve: async (id: string) => {
          const s = sessions.get(id);
          if (!s) throw Object.assign(new Error("No such session"), { statusCode: 404 });
          return s;
        },
        expire: async (id: string) => {
          expired.push(id);
          const s = sessions.get(id);
          if (s) s.status = "expired";
          return s;
        },
      },
    },
    refunds: { create: async () => ({ id: "re_x", status: "succeeded", amount: 0 }) },
  };
  return {
    stripe: fake, sessions, creates, expired,
    reset: () => { sessions.clear(); creates.length = 0; expired.length = 0; },
  };
});

vi.mock("../../lib/stripe", () => ({ requireStripe: () => fakeStripe.stripe, stripe: fakeStripe.stripe }));
vi.mock("@clerk/express", () => ({ getAuth: (req: any) => ({ userId: req.clerkUserId ?? null }) }));

const SELLER_ID = `w1s01-ad-seller-${crypto.randomBytes(4).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"] ?? SELLER_ID;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  teamContext: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(_b: any, _m: any, path: string) { return path; }
    async getObjectEntityDownloadURL(path: string) { return `https://cdn.test/${path}`; }
  },
}));
vi.mock("../../lib/ads/reachAudience", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ads/reachAudience")>();
  return {
    ...actual,
    loadReachModel: async (...args: Parameters<typeof actual.loadReachModel>) => {
      if (hooks.onReach) { const h = hooks.onReach; hooks.onReach = null; await h(); }
      return actual.loadReachModel(...args);
    },
  };
});

import adCampaignsRouter from "../ad-campaigns";

let server: Server;
let base = "";
const created: string[] = [];

beforeAll(async () => {
  const app = express();
  app.use("/api/ad-campaigns", adCampaignsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ad-campaigns`;
});

afterAll(async () => {
  if (created.length) await db.delete(adCampaigns).where(inArray(adCampaigns.id, created));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => { fakeStripe.reset(); hooks.onReach = null; hooks.onCreate = null; });

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": SELLER_ID },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function readyCampaign(daily = 1_000, days = 2) {
  const { body } = await call("POST", "/", {});
  const id = body.campaign.id as string;
  created.push(id);
  await db.update(adCampaigns).set({
    mediaObjectPaths: ["/objects/ad-campaigns/x/1"], mediaMimeTypes: ["image/jpeg"],
    formats: ["portrait_4x5"], ctaKind: "learn_more", ctaDestinationKind: "store",
  }).where(eq(adCampaigns.id, id));
  expect((await call("PATCH", `/${id}`, { dailyBudgetCents: daily, durationDays: days })).status).toBe(200);
  return id;
}

const returnUrl = (id: string) => `brandthread://design-campaign/?id=${id}&paymentReturn=1`;
const rowOf = async (id: string) => (await db.select().from(adCampaigns).where(eq(adCampaigns.id, id)).limit(1))[0]!;

describe("malformed ids", () => {
  it("is a 404 on every :id route, never a 500", async () => {
    for (const [method, path] of [
      ["GET", "/not-a-uuid"], ["PATCH", "/not-a-uuid"], ["DELETE", "/not-a-uuid"],
      ["POST", "/not-a-uuid/pay"], ["POST", "/not-a-uuid/pay/verify"], ["POST", "/not-a-uuid/pause"],
      ["POST", "/not-a-uuid/resume"], ["POST", "/not-a-uuid/stop"], ["GET", "/not-a-uuid/results"],
      ["POST", "/not-a-uuid/reorder-media"], ["DELETE", "/not-a-uuid/media/0"],
    ] as const) {
      const { status } = await call(method, path, method === "GET" || method === "DELETE" ? undefined : {});
      expect(`${method} ${path} ${status}`).toBe(`${method} ${path} 404`);
    }
  });

  it("a non-uuid product CTA destination is a 422, never a 500", async () => {
    const id = await readyCampaign();
    const { status } = await call("PATCH", `/${id}`, { ctaKind: "shop_now", ctaDestinationId: "nope" });
    expect(status).toBe(422);
  });
});

describe("PATCH vs a concurrent /pay", () => {
  it("refuses to change the budget once the campaign moved to pending_payment", async () => {
    const id = await readyCampaign(1_000, 2);
    // A concurrent /pay lands between PATCH's status check and its write.
    hooks.onReach = async () => {
      await db.update(adCampaigns).set({ status: "pending_payment", stripeCheckoutSessionId: `cs_race_${id}` })
        .where(eq(adCampaigns.id, id));
    };
    const { status } = await call("PATCH", `/${id}`, { dailyBudgetCents: 100_000, durationDays: 30 });
    expect(status).toBe(409);
    const row = await rowOf(id);
    expect(row.budgetCents).toBe(2_000);
    expect(row.status).toBe("pending_payment");
  });
});

describe("/pay vs a concurrent PATCH", () => {
  it("does not persist a session priced at a budget the campaign no longer has", async () => {
    const id = await readyCampaign(1_000, 2);
    // The budget changes while Stripe is creating the session for 2,000 cents.
    hooks.onCreate = async () => {
      await db.update(adCampaigns).set({ budgetCents: 3_000_000, dailyBudgetCents: 100_000, durationDays: 30 })
        .where(eq(adCampaigns.id, id));
    };
    const first = await call("POST", `/${id}/pay`, { returnUrl: returnUrl(id) });
    expect(first.status).toBe(409);
    expect(first.body.code).toBe("campaign_changed");
    const afterRace = await rowOf(id);
    expect(afterRace.status).toBe("draft");
    expect(afterRace.stripeCheckoutSessionId).toBeNull();
    expect(fakeStripe.expired).toHaveLength(1);

    // The retry gets a fresh session at the current total, not the stale one.
    const retry = await call("POST", `/${id}/pay`, { returnUrl: returnUrl(id) });
    expect(retry.status).toBe(201);
    expect(fakeStripe.creates.at(-1)!.params.line_items[0].price_data.unit_amount).toBe(3_000_000);
    expect(fakeStripe.creates.at(-1)!.key).not.toBe(fakeStripe.creates[0]!.key);
    expect((await rowOf(id)).stripeCheckoutSessionId).toBe(retry.body.sessionId);
  });
});
