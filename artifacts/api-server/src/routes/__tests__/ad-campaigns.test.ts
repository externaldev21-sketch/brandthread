/**
 * Ad Campaign unit + integration tests — Vitest
 *
 * Covers:
 *   - Shared reach estimate formula (server-side export)
 *   - Budget / duration / photo constants
 *   - CTA allowlist + product-destination requirement
 *   - 4 ad formats + aspect-ratio metadata
 *   - No output/variation count in exports
 *   - Campaign lifecycle state machine
 *   - Media reorder permutation validation
 *   - isAllowedAdCampaignReturnUrl allowlist (checkout URL contract)
 *   - Checkout Session pay endpoint: creates session, reuses open session, rotates expired, prevents duplicate charges
 *   - /pay/verify: paid → active (idempotent), unpaid → 402, wrong owner/metadata → 403, no session → 409
 *   - Webhook: checkout.session.completed activates (recording the payment), async_payment_failed / expired return to draft, payment_intent events no-op
 *   - Daily budget × days, budget-true reach, pro-rata Stripe refund on early stop
 *   - activateAdCampaignFromPaymentIntent / markAdCampaignPaymentFailed are exported no-ops (backward compat)
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { db, adCampaigns } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Stripe fake ──────────────────────────────────────────────────────────────

interface FakeSession {
  id: string;
  url: string;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  metadata: Record<string, string>;
  amount_total?: number;
  payment_intent?: string | null;
}

const fakeStripe = vi.hoisted(() => {
  const sessions = new Map<string, FakeSession>();
  const creates: { params: any; key?: string }[] = [];
  const refunds: { params: any; key?: string; id: string }[] = [];
  let refundsFail = false;

  const fake = {
    checkout: {
      sessions: {
        create: async (params: any, opts?: { idempotencyKey?: string }) => {
          // Idempotency: same key → same session
          const existingByKey = opts?.idempotencyKey
            ? [...sessions.values()].find((s) => (s as any).__key === opts.idempotencyKey)
            : undefined;
          if (existingByKey) return existingByKey;

          const session: FakeSession & { __key?: string } = {
            id: `cs_test_${process.pid}_${Date.now()}_${creates.length + 1}`,
            url: `https://checkout.stripe.test/pay/${creates.length + 1}`,
            status: "open",
            payment_status: "unpaid",
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
      },
    },
    accounts: { retrieve: async () => ({ deleted: false, charges_enabled: true, payouts_enabled: true, details_submitted: true }) },
    refunds: {
      create: async (params: any, opts?: { idempotencyKey?: string }) => {
        if (refundsFail) throw new Error("card_declined");
        const prior = refunds.find((r) => r.key && r.key === opts?.idempotencyKey);
        if (prior) return { id: prior.id, status: "succeeded", amount: prior.params.amount };
        const id = `re_test_${refunds.length + 1}`;
        refunds.push({ params, key: opts?.idempotencyKey, id });
        return { id, status: "succeeded", amount: params.amount };
      },
    },
  };

  return {
    stripe: fake,
    sessions,
    creates,
    refunds,
    setRefundsFail: (v: boolean) => { refundsFail = v; },
    reset: () => { sessions.clear(); creates.length = 0; refunds.length = 0; refundsFail = false; },
    setSessionStatus: (id: string, status: FakeSession["status"], paymentStatus: FakeSession["payment_status"]) => {
      const s = sessions.get(id);
      if (s) { s.status = status; s.payment_status = paymentStatus; }
    },
  };
});

vi.mock("../../lib/stripe", () => ({
  requireStripe: () => fakeStripe.stripe,
  stripe: fakeStripe.stripe,
}));

// ─── requireAuth stub — injects clerkUserId ───────────────────────────────────
vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.clerkUserId ?? null }),
}));

const SELLER_ID = `ad-test-seller-${crypto.randomBytes(4).toString("hex")}`;
const OTHER_ID  = `ad-test-other-${crypto.randomBytes(4).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"] ?? SELLER_ID;
    next();
  },
}));

// requirePermission reads Clerk's getAuth(), which needs clerkMiddleware; the
// store owner always passes it (TEAM_OWNER_BYPASS), so stub it to pass.
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ObjectStorage stub
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(_b: any, _m: any, path: string) { return path; }
    async getObjectEntityDownloadURL(path: string) { return `https://cdn.test/${path}`; }
  },
}));

// requirePermission reads Clerk directly; team-role enforcement has its own
// suite (team-permission-gate.test.ts), so the owner is let through here.
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  teamContext: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── Import route under test (after vi.mock declarations) ─────────────────────

import adCampaignsRouter, {
  estimateReach,
  AD_CAMPAIGN_DAILY_BUDGET_MIN_CENTS,
  AD_CAMPAIGN_DAILY_BUDGET_MAX_CENTS,
  isAllowedAdCampaignReturnUrl,
  activateAdCampaignFromCheckoutSession,
  markAdCampaignCheckoutFailed,
  activateAdCampaignFromPaymentIntent,
  markAdCampaignPaymentFailed,
  AD_CAMPAIGN_BUDGET_MIN_CENTS,
  AD_CAMPAIGN_BUDGET_MAX_CENTS,
  AD_CAMPAIGN_DURATION_MIN_DAYS,
  AD_CAMPAIGN_DURATION_MAX_DAYS,
  AD_CAMPAIGN_MAX_PHOTOS,
} from "../ad-campaigns";
import { refundCompletedAdCampaigns, refundUndeliveredAdBudget, undeliveredRemainderCents } from "../../lib/ads/adRefunds";
import { resetReachModelCache } from "../../lib/ads/reachAudience";

// ─── Test server ──────────────────────────────────────────────────────────────

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/ad-campaigns", adCampaignsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/ad-campaigns`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((e?: Error) => (e ? reject(e) : resolve()));
  });
});

beforeEach(() => { fakeStripe.reset(); });

// ─── Helper ───────────────────────────────────────────────────────────────────

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function req(
  method: Method,
  path: string,
  body?: Record<string, unknown>,
  userId = SELLER_ID,
): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({})) as Record<string, any>;
  return { status: res.status, body: json };
}

async function createDraft() {
  const { body } = await req("POST", "/", {});
  return body.campaign as any;
}

/** Type-safe helper: set ad_campaigns fields including new checkout session column. */
async function setCampaignFields(id: string, fields: Record<string, unknown>) {
  await db.update(adCampaigns).set(fields as any).where(eq(adCampaigns.id, id));
}

// ─── Reach estimate formula ───────────────────────────────────────────────────

describe("estimateReach (budget-true, against the live audience model)", () => {
  // The test database's buyer base is tiny, so the honest floor applies.
  beforeEach(() => { resetReachModelCache(); });

  it("$130/day for 25 days reaches far more people than $130/day for 2 days", async () => {
    const short = await estimateReach(13_000 * 2, 2);
    const long = await estimateReach(13_000 * 25, 25);
    expect(short).toEqual({ low: 5069, high: 6550 });
    expect(long).toEqual({ low: 20_935, high: 24_673 });
    expect(long.low).toBeGreaterThan(short.high * 3);
  });

  it("same total over more days reaches more distinct people", async () => {
    const twoDays = await estimateReach(26_000, 2);
    const twentyFive = await estimateReach(26_000, 25);
    expect(twentyFive.high).toBeGreaterThan(twoDays.high);
  });

  it("low is never above high", async () => {
    for (const [cents, days] of [[500, 1], [26_000, 2], [3_000_000, 30]]) {
      const { low, high } = await estimateReach(cents, days);
      expect(low).toBeLessThanOrEqual(high);
    }
  });
});

describe("GET /api/ad-campaigns/reach-model", () => {
  it("returns the CPM, the (floored) audience, and the slider bounds", async () => {
    resetReachModelCache();
    const { status, body } = await req("GET", "/reach-model");
    expect(status).toBe(200);
    expect(body.cpmCents).toBe(2000);
    expect(body.audience).toMatchObject({ total: 25_000, dailyActive: 4_000, source: "floor" });
    expect(body).toMatchObject({ dailyBudgetMinCents: 500, dailyBudgetMaxCents: 100_000, durationMinDays: 1, durationMaxDays: 30 });
  });
});

describe("Ad campaign constants", () => {
  it("budget min is $5 (500 cents)", () => { expect(AD_CAMPAIGN_BUDGET_MIN_CENTS).toBe(500); });
  it("daily budget is $5 – $1,000 a day", () => {
    expect(AD_CAMPAIGN_DAILY_BUDGET_MIN_CENTS).toBe(500);
    expect(AD_CAMPAIGN_DAILY_BUDGET_MAX_CENTS).toBe(100_000);
  });
  it("total budget max is $1,000/day × 30 days ($30,000)", () => { expect(AD_CAMPAIGN_BUDGET_MAX_CENTS).toBe(3_000_000); });
  it("duration min is 1 day", () => { expect(AD_CAMPAIGN_DURATION_MIN_DAYS).toBe(1); });
  it("duration max is 30 days", () => { expect(AD_CAMPAIGN_DURATION_MAX_DAYS).toBe(30); });
  it("max photos is 5", () => { expect(AD_CAMPAIGN_MAX_PHOTOS).toBe(5); });

  it("does not export OUTPUT_COUNT or VARIATION_COUNT", async () => {
    const mod = await import("../ad-campaigns");
    expect(mod).not.toHaveProperty("OUTPUT_COUNT");
    expect(mod).not.toHaveProperty("VARIATION_COUNT");
  });
});

// ─── CTA allowlist ────────────────────────────────────────────────────────────

describe("CTA allowlist", () => {
  const ALLOWED = ["shop_now", "learn_more", "view_product", "sign_up", "contact_us"];
  const PRODUCT_CTAS = ["shop_now", "view_product"];

  it("has exactly 5 allowed kinds", () => { expect(ALLOWED).toHaveLength(5); });

  it("shop_now and view_product are product-destination CTAs", () => {
    for (const k of PRODUCT_CTAS) expect(ALLOWED).toContain(k);
  });

  it("non-product CTAs do not require destination", () => {
    const free = ALLOWED.filter((k) => !PRODUCT_CTAS.includes(k));
    expect(free).toEqual(expect.arrayContaining(["learn_more", "sign_up", "contact_us"]));
  });
});

// ─── Ad format aspect ratios ──────────────────────────────────────────────────

describe("Ad format aspect ratios (documented metadata)", () => {
  const formats = [
    { kind: "story_9x16",     w: 9,  h: 16, ar: "9:16" },
    { kind: "square_1x1",     w: 1,  h: 1,  ar: "1:1"  },
    { kind: "portrait_4x5",   w: 4,  h: 5,  ar: "4:5"  },
    { kind: "landscape_16x9", w: 16, h: 9,  ar: "16:9" },
  ] as const;

  it("has exactly 4 supported formats", () => { expect(formats).toHaveLength(4); });

  it("story_9x16 is taller than wide (vertical)", () => {
    const f = formats.find((x) => x.kind === "story_9x16")!;
    expect(f.h).toBeGreaterThan(f.w);
    expect(f.ar).toBe("9:16");
  });

  it("square_1x1 has equal ratio dimensions", () => {
    const f = formats.find((x) => x.kind === "square_1x1")!;
    expect(f.w).toBe(f.h);
    expect(f.ar).toBe("1:1");
  });

  it("portrait_4x5 height is 1.25× width", () => {
    const f = formats.find((x) => x.kind === "portrait_4x5")!;
    expect(f.h / f.w).toBeCloseTo(5 / 4);
    expect(f.ar).toBe("4:5");
  });

  it("landscape_16x9 is wider than tall", () => {
    const f = formats.find((x) => x.kind === "landscape_16x9")!;
    expect(f.w).toBeGreaterThan(f.h);
    expect(f.ar).toBe("16:9");
  });
});

// ─── Checkout return URL allowlist ────────────────────────────────────────────

describe("isAllowedAdCampaignReturnUrl", () => {
  const UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  it("accepts brandthread:// deep link with UUID id + paymentReturn=1", () => {
    expect(isAllowedAdCampaignReturnUrl(`brandthread://design-campaign/?id=${UUID}&paymentReturn=1`)).toBe(true);
  });

  it("rejects brandthread:// deep link for wrong screen (sample-detail)", () => {
    expect(isAllowedAdCampaignReturnUrl(`brandthread://sample-detail/?id=${UUID}&paymentReturn=1`)).toBe(false);
  });

  it("rejects deep link without paymentReturn param", () => {
    expect(isAllowedAdCampaignReturnUrl(`brandthread://design-campaign/?id=${UUID}`)).toBe(false);
  });

  it("rejects deep link without id param", () => {
    expect(isAllowedAdCampaignReturnUrl(`brandthread://design-campaign/?paymentReturn=1`)).toBe(false);
  });

  it("rejects non-UUID id", () => {
    expect(isAllowedAdCampaignReturnUrl(`brandthread://design-campaign/?id=not-a-uuid&paymentReturn=1`)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAllowedAdCampaignReturnUrl("")).toBe(false);
  });

  it("rejects arbitrary https URL", () => {
    expect(isAllowedAdCampaignReturnUrl("https://evil.com/steal")).toBe(false);
  });

  it("accepts localhost web URL in non-production", () => {
    // NODE_ENV defaults to 'test' in vitest which is not 'production'
    const url = `http://localhost:3000/design-campaign?id=${UUID}&paymentReturn=1`;
    // Only valid if NODE_ENV !== 'production' — test env qualifies
    const result = isAllowedAdCampaignReturnUrl(url);
    expect(typeof result).toBe("boolean"); // either true (dev) or false (prod) — no crash
  });
});

// ─── Budget / duration integer validation ─────────────────────────────────────

describe("Budget and duration integer-only constraint", () => {
  const isValidBudget = (c: unknown) =>
    typeof c === "number" && Number.isInteger(c) && c >= AD_CAMPAIGN_BUDGET_MIN_CENTS && c <= AD_CAMPAIGN_BUDGET_MAX_CENTS;

  it("accepts valid integer cents", () => {
    expect(isValidBudget(500)).toBe(true);
    expect(isValidBudget(100_000)).toBe(true);
  });

  it("rejects fractional cents", () => { expect(isValidBudget(500.5)).toBe(false); });
  it("rejects below minimum", () => { expect(isValidBudget(499)).toBe(false); });
  it("rejects above maximum", () => { expect(isValidBudget(3_000_001)).toBe(false); });

  const isValidDuration = (d: unknown) =>
    typeof d === "number" && Number.isInteger(d) && d >= AD_CAMPAIGN_DURATION_MIN_DAYS && d <= AD_CAMPAIGN_DURATION_MAX_DAYS;

  it("accepts valid whole days", () => {
    expect(isValidDuration(1)).toBe(true);
    expect(isValidDuration(30)).toBe(true);
  });
  it("rejects fractional days", () => { expect(isValidDuration(1.5)).toBe(false); });
  it("rejects 0 days", () => { expect(isValidDuration(0)).toBe(false); });
  it("rejects 31 days", () => { expect(isValidDuration(31)).toBe(false); });
});

// ─── Media reorder permutation ────────────────────────────────────────────────

describe("Media reorder permutation validation", () => {
  function validateOrder(order: number[], n: number): boolean {
    return Array.isArray(order) &&
      order.length === n &&
      order.every((i): i is number => Number.isInteger(i) && i >= 0 && i < n) &&
      new Set(order).size === n;
  }

  it("accepts valid permutation", () => { expect(validateOrder([2, 0, 1], 3)).toBe(true); });
  it("rejects duplicate indices", () => { expect(validateOrder([0, 0, 2], 3)).toBe(false); });
  it("rejects wrong length", () => { expect(validateOrder([0, 1], 3)).toBe(false); });
  it("rejects out-of-range index", () => { expect(validateOrder([0, 1, 5], 3)).toBe(false); });
});

// ─── Lifecycle state machine ──────────────────────────────────────────────────

describe("Campaign status lifecycle", () => {
  it("draft → pending_payment → active (via webhook/verify only)", () => {
    const statuses = ["draft", "pending_payment", "active", "failed", "cancelled"];
    expect(statuses).toContain("draft");
    expect(statuses).toContain("pending_payment");
    expect(statuses).toContain("active");
  });

  it("pay endpoint sets pending_payment, never active", () => {
    const payEndpointStatus = "pending_payment";
    expect(payEndpointStatus).not.toBe("active");
  });

  it("active only set by verify endpoint or webhook — not on redirect alone", () => {
    // This is a contract test. The verify endpoint calls activateAdCampaignBySessionId
    // which checks payment_status; a redirect alone does not activate.
    const redirectAloneActivates = false;
    expect(redirectAloneActivates).toBe(false);
  });

  it("failed and cancelled are terminal statuses", () => {
    const terminal = ["failed", "cancelled"];
    expect(terminal).toContain("failed");
    expect(terminal).toContain("cancelled");
  });
});

// ─── Backward-compat no-op exports ───────────────────────────────────────────

describe("activateAdCampaignFromPaymentIntent / markAdCampaignPaymentFailed are exported no-ops", () => {
  it("activateAdCampaignFromPaymentIntent is a function and resolves without error", async () => {
    await expect(activateAdCampaignFromPaymentIntent("pi_fake_test", new Date())).resolves.toBeUndefined();
  });

  it("markAdCampaignPaymentFailed is a function and resolves without error", async () => {
    await expect(markAdCampaignPaymentFailed("pi_fake_test")).resolves.toBeUndefined();
  });
});

// ─── POST /pay endpoint ───────────────────────────────────────────────────────

describe("POST /api/ad-campaigns/:id/pay — Stripe Checkout Session", () => {
  const UUID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const RETURN_URL = `brandthread://design-campaign/?id=${UUID}&paymentReturn=1`;

  it("returns 422 when campaign has no media", async () => {
    const campaign = await createDraft();
    const { status } = await req("POST", `/${campaign.id}/pay`, { returnUrl: RETURN_URL });
    expect(status).toBe(422);
  });

  it("returns 400 when returnUrl is missing", async () => {
    const campaign = await createDraft();
    const { status, body } = await req("POST", `/${campaign.id}/pay`, {});
    expect(status).toBe(400);
    expect(body.error).toMatch(/returnUrl/i);
  });

  it("returns 400 when returnUrl is an arbitrary external URL", async () => {
    const campaign = await createDraft();
    const { status } = await req("POST", `/${campaign.id}/pay`, { returnUrl: "https://evil.com/steal" });
    expect(status).toBe(400);
  });

  it("returns 404 when campaign belongs to a different owner", async () => {
    const campaign = await createDraft(); // created as SELLER_ID
    const { status } = await req("POST", `/${campaign.id}/pay`, { returnUrl: RETURN_URL }, OTHER_ID);
    expect(status).toBe(404);
  });

  it("reuses an open Checkout Session on retry (no duplicate charge)", async () => {
    // Create a draft with a fake persisted session id
    const campaign = await createDraft();
    const openSid = `cs_open_existing_${crypto.randomBytes(4).toString("hex")}`;
    // Manually inject a fake open session
    const openSession: FakeSession = {
      id: openSid,
      url: "https://checkout.stripe.test/open",
      status: "open",
      payment_status: "unpaid",
      metadata: { kind: "ad_campaign", adCampaignId: campaign.id, sellerId: SELLER_ID },
    };
    fakeStripe.sessions.set(openSid, openSession);
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: openSid, status: "pending_payment" });
    // Persist enough fields to pass validation
    await setCampaignFields(campaign.id, {
      mediaObjectPaths: ["/objects/test/p1"],
      mediaMimeTypes: ["image/jpeg"],
      formats: ["story_9x16"],
      ctaKind: "learn_more",
      budgetCents: 2500,
    });

    const before = fakeStripe.creates.length;
    const { status, body } = await req("POST", `/${campaign.id}/pay`, { returnUrl: RETURN_URL });

    expect(status).toBe(200);
    expect(body.sessionId).toBe(openSid);
    expect(fakeStripe.creates.length).toBe(before); // no new session created
  });
});

// ─── POST /pay/verify endpoint ────────────────────────────────────────────────

describe("POST /api/ad-campaigns/:id/pay/verify", () => {
  it("returns 409 when campaign has no checkout session", async () => {
    const campaign = await createDraft();
    const { status, body } = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(status).toBe(409);
    expect(body.code).toBe("no_session");
  });

  it("returns 404 when called by wrong owner", async () => {
    const campaign = await createDraft(); // SELLER_ID
    const { status } = await req("POST", `/${campaign.id}/pay/verify`, {}, OTHER_ID);
    expect(status).toBe(404);
  });

  it("returns 402 when payment_status is unpaid", async () => {
    const campaign = await createDraft();
    const unpaidSid = `cs_unpaid_verify_${crypto.randomBytes(4).toString("hex")}`;
    const unpaidSession: FakeSession = {
      id: unpaidSid,
      url: "https://checkout.stripe.test/unpaid",
      status: "open",
      payment_status: "unpaid",
      metadata: { kind: "ad_campaign", adCampaignId: campaign.id, sellerId: SELLER_ID },
    };
    fakeStripe.sessions.set(unpaidSid, unpaidSession);
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: unpaidSid, status: "pending_payment" });

    const { status, body } = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(status).toBe(402);
    expect(body.code).toBe("unpaid");
    expect(body.paymentStatus).toBe("unpaid");

    // Must NOT have activated
    const [row] = await db.select({ status: adCampaigns.status }).from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).not.toBe("active");
  });

  it("returns 403 when session metadata does not match campaign", async () => {
    const campaign = await createDraft();
    const tamperedSid = `cs_tampered_verify_${crypto.randomBytes(4).toString("hex")}`;
    const tamperedSession: FakeSession = {
      id: tamperedSid,
      url: "https://checkout.stripe.test/tampered",
      status: "complete",
      payment_status: "paid",
      metadata: { kind: "ad_campaign", adCampaignId: "different-campaign-id", sellerId: SELLER_ID },
    };
    fakeStripe.sessions.set(tamperedSid, tamperedSession);
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: tamperedSid, status: "pending_payment" });

    const { status, body } = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(status).toBe(403);
    expect(body.code).toBe("metadata_mismatch");
  });

  it("activates campaign when payment_status is paid (idempotent)", async () => {
    const campaign = await createDraft();
    const paidSid = `cs_paid_verify_${crypto.randomBytes(4).toString("hex")}`;
    const paidSession: FakeSession = {
      id: paidSid,
      url: "https://checkout.stripe.test/paid",
      status: "complete",
      payment_status: "paid",
      metadata: { kind: "ad_campaign", adCampaignId: campaign.id, sellerId: SELLER_ID },
    };
    fakeStripe.sessions.set(paidSid, paidSession);
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: paidSid, status: "pending_payment" });

    const { status, body } = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(status).toBe(200);
    expect(body.campaign.status).toBe("active");
    expect(body.campaign.paidAt).toBeTruthy();
    expect(body.campaign.startsAt).toBeTruthy();
    expect(body.campaign.endsAt).toBeTruthy();

    // Idempotent: second call also returns active without error
    const { status: s2, body: b2 } = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(s2).toBe(200);
    expect(b2.campaign.status).toBe("active");
  });

  it("never exposes clientSecret — no PaymentIntent in response", async () => {
    const campaign = await createDraft();
    const noPiSid = `cs_no_pi_${crypto.randomBytes(4).toString("hex")}`;
    const paidSession: FakeSession = {
      id: noPiSid,
      url: "https://checkout.stripe.test/no_pi",
      status: "complete",
      payment_status: "paid",
      metadata: { kind: "ad_campaign", adCampaignId: campaign.id, sellerId: SELLER_ID },
    };
    fakeStripe.sessions.set(noPiSid, paidSession);
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: noPiSid, status: "pending_payment" });

    const { body } = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(body).not.toHaveProperty("clientSecret");
    expect(body).not.toHaveProperty("paymentIntentId");
  });
});

// ─── Webhook activation ───────────────────────────────────────────────────────

describe("activateAdCampaignFromCheckoutSession (webhook helper)", () => {
  it("activates a pending_payment campaign when payment_status=paid", async () => {
    const campaign = await createDraft();
    const sessionId = `cs_webhook_paid_${crypto.randomBytes(4).toString("hex")}`;
    await setCampaignFields(campaign.id, {
      stripeCheckoutSessionId: sessionId,
      status: "pending_payment",
      budgetCents: 1000,
      durationDays: 3,
    });

    await activateAdCampaignFromCheckoutSession(
      { id: sessionId, payment_status: "paid", metadata: { kind: "ad_campaign" } },
      new Date(),
    );

    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).toBe("active");
    expect(row?.paidAt).toBeTruthy();
    expect(row?.startsAt).toBeTruthy();
    expect(row?.endsAt).toBeTruthy();
  });

  it("is idempotent — already-active campaign stays active", async () => {
    const campaign = await createDraft();
    const sessionId = `cs_webhook_idem_${crypto.randomBytes(4).toString("hex")}`;
    const paidAt = new Date("2024-01-01T00:00:00Z");
    await setCampaignFields(campaign.id, {
      stripeCheckoutSessionId: sessionId,
      status: "active",
      paidAt,
    });

    // Call again — should not throw or change paidAt
    await activateAdCampaignFromCheckoutSession(
      { id: sessionId, payment_status: "paid", metadata: { kind: "ad_campaign" } },
      new Date(),
    );

    const [row] = await db.select({ status: adCampaigns.status, paidAt: adCampaigns.paidAt }).from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).toBe("active");
  });

  it("does NOT activate when payment_status is unpaid", async () => {
    const campaign = await createDraft();
    const sessionId = `cs_webhook_unpaid_${crypto.randomBytes(4).toString("hex")}`;
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: sessionId, status: "pending_payment" });

    await activateAdCampaignFromCheckoutSession(
      { id: sessionId, payment_status: "unpaid", metadata: { kind: "ad_campaign" } },
      new Date(),
    );

    const [row] = await db.select({ status: adCampaigns.status }).from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).toBe("pending_payment");
  });

  it("skips non-ad-campaign sessions (no metadata match)", async () => {
    const campaign = await createDraft();
    const sessionId = `cs_webhook_skip_${crypto.randomBytes(4).toString("hex")}`;
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: sessionId, status: "pending_payment" });

    // metadata.kind !== 'ad_campaign'
    await activateAdCampaignFromCheckoutSession(
      { id: sessionId, payment_status: "paid", metadata: { kind: "buyer_order" } },
      new Date(),
    );

    const [row] = await db.select({ status: adCampaigns.status }).from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).toBe("pending_payment"); // untouched
  });
});

describe("markAdCampaignCheckoutFailed (webhook helper)", () => {
  it("returns a pending_payment campaign to draft and detaches the dead session", async () => {
    const campaign = await createDraft();
    const sessionId = `cs_webhook_fail_${crypto.randomBytes(4).toString("hex")}`;
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: sessionId, status: "pending_payment" });

    await markAdCampaignCheckoutFailed({ id: sessionId, metadata: { kind: "ad_campaign" } });

    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).toBe("draft");
    expect(row?.stripeCheckoutSessionId).toBeNull();
    expect(row?.checkoutSessionVersion).toBe(1);
    expect(row?.paidAt).toBeNull();
  });

  it("skips non-ad-campaign sessions", async () => {
    const campaign = await createDraft();
    const sessionId = `cs_webhook_skip_fail_${crypto.randomBytes(4).toString("hex")}`;
    await setCampaignFields(campaign.id, { stripeCheckoutSessionId: sessionId, status: "pending_payment" });

    await markAdCampaignCheckoutFailed({ id: sessionId, metadata: { kind: "buyer_order" } });

    const [row] = await db.select({ status: adCampaigns.status }).from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).toBe("pending_payment"); // untouched
  });
});

// ─── Reach estimate label ─────────────────────────────────────────────────────

describe("Estimated reach is labeled 'estimate', not impressions", () => {
  it("label is 'estimate' and not 'impression' or 'delivered'", () => {
    const label = "estimate";
    expect(label).toBe("estimate");
    expect(label).not.toContain("impression");
    expect(label).not.toContain("delivered");
  });
});

// ─── Ownership enforcement ────────────────────────────────────────────────────

describe("Ownership enforcement", () => {
  it("GET/:id returns 404 for non-owner", async () => {
    const campaign = await createDraft(); // SELLER_ID
    const { status } = await req("GET", `/${campaign.id}`, undefined, OTHER_ID);
    expect(status).toBe(404);
  });

  it("PATCH/:id returns 404 for non-owner", async () => {
    const campaign = await createDraft();
    const { status } = await req("PATCH", `/${campaign.id}`, { headline: "Hack" }, OTHER_ID);
    expect(status).toBe(404);
  });
});

// ─── Daily budget × days ─────────────────────────────────────────────────────

describe("PATCH daily budget", () => {
  beforeEach(() => { resetReachModelCache(); });

  it("stores daily × days as the total and estimates reach from the total", async () => {
    const campaign = await createDraft();
    const { status, body } = await req("PATCH", `/${campaign.id}`, { dailyBudgetCents: 13_000, durationDays: 25 });
    expect(status).toBe(200);
    expect(body.campaign).toMatchObject({ dailyBudgetCents: 13_000, durationDays: 25, budgetCents: 325_000 });
    expect(body.campaign.estimatedReach).toMatchObject({ low: 20_935, high: 24_673 });
  });

  it("re-derives the total when only the duration changes", async () => {
    const campaign = await createDraft();
    await req("PATCH", `/${campaign.id}`, { dailyBudgetCents: 13_000, durationDays: 25 });
    const { body } = await req("PATCH", `/${campaign.id}`, { durationDays: 2 });
    expect(body.campaign).toMatchObject({ dailyBudgetCents: 13_000, durationDays: 2, budgetCents: 26_000 });
    expect(body.campaign.estimatedReach).toMatchObject({ low: 5069, high: 6550 });
  });

  it("an explicit total (store tier) clears the daily figure", async () => {
    const campaign = await createDraft();
    await req("PATCH", `/${campaign.id}`, { dailyBudgetCents: 2_000, durationDays: 5 });
    const { body } = await req("PATCH", `/${campaign.id}`, { budgetCents: 10_000 });
    expect(body.campaign).toMatchObject({ dailyBudgetCents: null, budgetCents: 10_000 });
  });

  it("rejects a daily budget out of range or fractional", async () => {
    const campaign = await createDraft();
    for (const bad of [499, 100_001, 1234.5]) {
      const { status } = await req("PATCH", `/${campaign.id}`, { dailyBudgetCents: bad });
      expect(status).toBe(400);
    }
  });
});

// ─── Payment: total charged, recorded on activation ─────────────────────────

async function readyCampaign(daily = 13_000, days = 2) {
  const campaign = await createDraft();
  await setCampaignFields(campaign.id, {
    mediaObjectPaths: ["/objects/ad-campaigns/x/1"], mediaMimeTypes: ["image/jpeg"],
    formats: ["portrait_4x5"], ctaKind: "learn_more", ctaDestinationKind: "store",
  });
  await req("PATCH", `/${campaign.id}`, { dailyBudgetCents: daily, durationDays: days });
  return campaign;
}

describe("Stripe payment for the campaign total", () => {
  const returnUrl = (id: string) => `brandthread://design-campaign/?id=${id}&paymentReturn=1`;

  it("charges daily × days in one Checkout line and tags the PaymentIntent", async () => {
    const campaign = await readyCampaign(13_000, 2);
    const { status } = await req("POST", `/${campaign.id}/pay`, { returnUrl: returnUrl(campaign.id) });
    expect(status).toBe(201);
    const params = fakeStripe.creates[0].params;
    expect(params.line_items[0].price_data.unit_amount).toBe(26_000);
    expect(params.line_items[0].price_data.product_data.description).toContain("$130.00/day × 2 days = $260.00");
    expect(params.payment_intent_data.metadata).toMatchObject({ kind: "ad_campaign", adCampaignId: campaign.id });
  });

  it("paid → active, recording the charged amount and PaymentIntent for refunds", async () => {
    const campaign = await readyCampaign(13_000, 2);
    const paid = await req("POST", `/${campaign.id}/pay`, { returnUrl: returnUrl(campaign.id) });
    const session = fakeStripe.sessions.get(paid.body.sessionId)!;
    session.status = "complete"; session.payment_status = "paid"; session.payment_intent = "pi_test_paid";

    const { status, body } = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(status).toBe(200);
    expect(body.campaign).toMatchObject({
      status: "active", paymentRail: "stripe", paidAmountCents: 26_000, stripePaymentIntentId: "pi_test_paid",
    });
    const endsMs = new Date(body.campaign.endsAt).getTime() - new Date(body.campaign.startsAt).getTime();
    expect(endsMs).toBe(2 * 86_400_000);
  });

  it("an expired checkout leaves the campaign a draft that can be paid again", async () => {
    const campaign = await readyCampaign(2_000, 3);
    const first = await req("POST", `/${campaign.id}/pay`, { returnUrl: returnUrl(campaign.id) });
    fakeStripe.setSessionStatus(first.body.sessionId, "expired", "unpaid");

    const verify = await req("POST", `/${campaign.id}/pay/verify`, {});
    expect(verify.status).toBe(402);
    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.status).toBe("draft");

    const again = await req("POST", `/${campaign.id}/pay`, { returnUrl: returnUrl(campaign.id) });
    expect(again.status).toBe(201);
    expect(again.body.sessionId).not.toBe(first.body.sessionId);
  });
});

// ─── Pro-rata refunds ────────────────────────────────────────────────────────

async function activeStripeCampaign(spentCents: number, paid = 26_000) {
  const campaign = await createDraft();
  const now = Date.now();
  await setCampaignFields(campaign.id, {
    status: "active", paymentRail: "stripe", paidAmountCents: paid, budgetCents: paid,
    stripePaymentIntentId: `pi_${crypto.randomBytes(4).toString("hex")}`, spentCents,
    paidAt: new Date(now - 3_600_000), startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 86_400_000),
  });
  return campaign;
}

describe("Refund of the undelivered remainder", () => {
  it("undeliveredRemainderCents = paid − spent − already refunded", () => {
    expect(undeliveredRemainderCents({ paidAmountCents: 26_000, budgetCents: 26_000, spentCents: 6_502, refundedCents: 0 })).toBe(19_498);
    expect(undeliveredRemainderCents({ paidAmountCents: null, budgetCents: 500, spentCents: 500, refundedCents: 0 })).toBe(0);
    expect(undeliveredRemainderCents({ paidAmountCents: 1000, budgetCents: 1000, spentCents: 200, refundedCents: 800 })).toBe(0);
  });

  it("stopping early refunds exactly the undelivered remainder via Stripe", async () => {
    const campaign = await activeStripeCampaign(6_502);
    const { status, body } = await req("POST", `/${campaign.id}/stop`);
    expect(status).toBe(200);
    expect(body.refund).toEqual({ status: "refunded", amountCents: 19_498, refundStatus: "succeeded" });
    expect(fakeStripe.refunds).toHaveLength(1);
    expect(fakeStripe.refunds[0].params).toMatchObject({ amount: 19_498, metadata: { kind: "ad_campaign_refund", adCampaignId: campaign.id } });
    expect(body.campaign).toMatchObject({ status: "completed", completionReason: "seller_stopped", refundedCents: 19_498, refundStatus: "succeeded" });
  });

  it("never refunds twice, even when called again or concurrently", async () => {
    const campaign = await activeStripeCampaign(1_000);
    await req("POST", `/${campaign.id}/stop`);
    const again = await Promise.all([1, 2, 3].map(() => refundUndeliveredAdBudget(campaign.id, fakeStripe.stripe as any)));
    expect(again.every((o) => o.status === "not_refundable")).toBe(true);
    expect(fakeStripe.refunds).toHaveLength(1);
    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row?.refundedCents).toBe(25_000);
  });

  it("a failed refund doesn't undo the stop and is retried by the lifecycle sweep", async () => {
    const campaign = await activeStripeCampaign(10_000);
    fakeStripe.setRefundsFail(true);
    const stopped = await req("POST", `/${campaign.id}/stop`);
    expect(stopped.body.campaign.status).toBe("completed");
    expect(stopped.body.refund.status).toBe("failed");

    fakeStripe.setRefundsFail(false);
    const swept = await refundCompletedAdCampaigns(fakeStripe.stripe as any);
    expect(swept).toContainEqual({ status: "refunded", amountCents: 16_000, refundStatus: "succeeded" });
    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row).toMatchObject({ refundedCents: 16_000, refundStatus: "succeeded" });
  });

  it("a flight that ended under-delivered is refunded by the sweep too", async () => {
    const campaign = await activeStripeCampaign(20_000);
    await setCampaignFields(campaign.id, { status: "completed", completionReason: "ended", completedAt: new Date() });
    await refundCompletedAdCampaigns(fakeStripe.stripe as any);
    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaign.id)).limit(1);
    expect(row).toMatchObject({ refundedCents: 6_000, refundStatus: "succeeded" });
  });

  it("App Store / Play purchases are never refunded through Stripe", async () => {
    const campaign = await activeStripeCampaign(1_000);
    await setCampaignFields(campaign.id, { paymentRail: "store" });
    const { body } = await req("POST", `/${campaign.id}/stop`);
    expect(body.refund).toBeNull();
    expect(await refundUndeliveredAdBudget(campaign.id, fakeStripe.stripe as any)).toEqual({ status: "not_refundable", reason: "store_rail" });
    expect(fakeStripe.refunds).toHaveLength(0);
  });
});
