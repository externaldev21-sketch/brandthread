/**
 * Paid ad campaign delivery — end to end against real Postgres.
 *
 * Seller pays (fake Stripe + the real webhook activation helper) → buyers are
 * served the ad on Following / For You / Discover → viewable impressions are
 * billed at CPM → frequency caps hold → clicks are counted → seller results
 * reflect it. Also: pause/resume/stop, own/blocked/muted/suspended exclusion,
 * surface targeting, double-billing rejection, concurrent impressions never
 * overspend, budget exhaustion completes the campaign, ended campaigns
 * complete, and click → order attribution.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  adCampaigns, adClicks, adImpressions, blocks, db, mutedWords, orderItems, orders, productVariants, products, users,
} from "@workspace/db";

// ─── Stripe fake (same shape as ad-campaigns.test.ts) ─────────────────────────

const fakeStripe = vi.hoisted(() => {
  const sessions = new Map<string, any>();
  let n = 0;
  return {
    sessions,
    reset: () => { sessions.clear(); },
    stripe: {
      checkout: {
        sessions: {
          create: async (params: any) => {
            n += 1;
            const s = { id: `cs_ads_${process.pid}_${n}`, url: `https://checkout.stripe.test/${n}`, status: "open", payment_status: "unpaid", metadata: params.metadata ?? {} };
            sessions.set(s.id, s);
            return s;
          },
          retrieve: async (id: string) => sessions.get(id),
        },
      },
    },
  };
});

vi.mock("../../lib/stripe", () => ({
  requireStripe: () => fakeStripe.stripe,
  stripe: fakeStripe.stripe,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = user;
    next();
  },
}));

// requirePermission reads Clerk's getAuth(), which needs clerkMiddleware; the
// store owner always passes it (TEAM_OWNER_BYPASS), so stub it to pass.
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer(_b: any, _m: any, path: string) { return path; }
    async getObjectEntityDownloadURL(path: string) { return `https://cdn.test${path}`; }
  },
}));

import adCampaignsRouter, { activateAdCampaignFromCheckoutSession } from "../ad-campaigns";
import adsServeRouter from "../ads-serve";
import { completeEndedAdCampaigns } from "../../lib/ads/adDeliveryService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const P = `adsdel-${crypto.randomBytes(4).toString("hex")}`;
const SELLER = `${P}-seller`;
const SELLER2 = `${P}-seller2`;
const BUYERS = Array.from({ length: 6 }, (_, i) => `${P}-buyer${i}`);
const [BUYER, BUYER_BLOCKER, BUYER_MUTER, B3, B4, B5] = BUYERS;
const ALL_USERS = [SELLER, SELLER2, ...BUYERS];
let productId = "";
let variantId = "";

let server: Server;
let base = "";

async function call(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

let sessionCounter = 0;
const newSession = () => `sess_${P}_${++sessionCounter}`.replace(/[^A-Za-z0-9_-]/g, "_");

async function serve(user: string, surface: string, sessionId = newSession(), organicCount = 6, organicOffset = 0) {
  const qs = new URLSearchParams({ surface, sessionId, organicCount: String(organicCount), organicOffset: String(organicOffset) });
  const r = await call(user, "GET", `/api/ads/serve?${qs}`);
  expect(r.status).toBe(200);
  return r.body.ads as any[];
}

/** Seller creates + pays a campaign through the real routes; the webhook helper activates it. */
async function launchCampaign(opts: { seller?: string; headline?: string; budgetCents?: number; cta?: "shop_now" | "learn_more"; startedDaysAgo?: number; surfaces?: string[] } = {}) {
  const seller = opts.seller ?? SELLER;
  const created = await call(seller, "POST", "/api/ad-campaigns", {});
  expect(created.status).toBe(201);
  const id = created.body.campaign.id as string;
  const cta = opts.cta ?? "shop_now";
  const patched = await call(seller, "PATCH", `/api/ad-campaigns/${id}`, {
    headline: opts.headline ?? "Fall drop",
    description: "Heavyweight fleece",
    ctaKind: cta,
    ctaDestinationKind: cta === "shop_now" ? "product" : "store",
    ...(cta === "shop_now" ? { ctaDestinationId: productId } : {}),
    formats: ["portrait_4x5"],
    budgetCents: 500,
    durationDays: 7,
  });
  expect(patched.status).toBe(200);
  // Media upload is covered by ad-campaigns.test.ts; set the stored path directly.
  await db.update(adCampaigns).set({ mediaObjectPaths: [`/objects/ad-campaigns/${id}/a`], mediaMimeTypes: ["image/jpeg"] }).where(eq(adCampaigns.id, id));

  const paid = await call(seller, "POST", `/api/ad-campaigns/${id}/pay`, { returnUrl: `brandthread://design-campaign/?id=${id}&paymentReturn=1` });
  expect(paid.status).toBe(201);
  const session = fakeStripe.sessions.get(paid.body.sessionId);
  session.status = "complete";
  session.payment_status = "paid";
  await activateAdCampaignFromCheckoutSession(session, new Date());

  const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, id));
  expect(row.status).toBe("active");
  const patch: Record<string, unknown> = {};
  if (opts.budgetCents !== undefined) patch.budgetCents = opts.budgetCents;
  if (opts.surfaces) patch.surfaces = opts.surfaces;
  // Shift the flight back so pacing allows the full budget in tests that need it.
  const startedDaysAgo = opts.startedDaysAgo ?? 6.9;
  patch.startsAt = new Date(Date.now() - startedDaysAgo * 86_400_000);
  patch.endsAt = new Date(Date.now() + (7 - startedDaysAgo) * 86_400_000);
  await db.update(adCampaigns).set(patch as any).where(eq(adCampaigns.id, id));
  return id;
}

async function campaignRow(id: string) {
  const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, id));
  return row;
}

/** Only one campaign may be live at a time for deterministic serving. */
async function retireAllCampaigns() {
  await db.update(adCampaigns).set({ status: "cancelled" })
    .where(inArray(adCampaigns.sellerId, [SELLER, SELLER2]));
}

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined }; next(); });
  app.use("/api/ad-campaigns", adCampaignsRouter);
  app.use("/api/ads", adsServeRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(users).values(ALL_USERS.map((id) => ({
    clerkId: id, email: `${id}@example.test`, name: id, displayName: id.endsWith("seller") ? "North Fleece" : id,
    username: id.replace(/[^a-z0-9]/gi, "").slice(-24), accountType: id.includes("seller") ? "seller" : "buyer", onboardingComplete: true,
  })));
  const [product] = await db.insert(products).values({ ownerId: SELLER, name: "Fleece hoodie", status: "active", images: ["https://cdn.test/hoodie.jpg"] }).returning();
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({ productId, sku: `${P}-sku`, priceCents: 6_400, stock: 10 }).returning();
  variantId = variant.id;
});

beforeEach(async () => {
  fakeStripe.reset();
  await retireAllCampaigns();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const orderRows = await db.select({ id: orders.id }).from(orders).where(inArray(orders.ownerId, [SELLER, SELLER2]));
  if (orderRows.length) await db.delete(orders).where(inArray(orders.id, orderRows.map((o) => o.id)));
  await db.delete(adCampaigns).where(inArray(adCampaigns.sellerId, [SELLER, SELLER2]));
  await db.delete(products).where(inArray(products.ownerId, [SELLER, SELLER2]));
  await db.delete(blocks).where(inArray(blocks.blockerId, ALL_USERS));
  await db.delete(mutedWords).where(inArray(mutedWords.userId, ALL_USERS));
  await db.delete(users).where(inArray(users.clerkId, ALL_USERS));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ad delivery: paid campaign → buyer feeds → seller results", () => {
  it("serves on every surface, bills viewable impressions once, caps frequency, counts clicks, and reports results", async () => {
    const id = await launchCampaign();

    // Following: one ad after the 6th organic item, with creative + one-time token.
    const s1 = newSession();
    const following = await serve(BUYER, "following", s1);
    expect(following).toHaveLength(1);
    const ad = following[0];
    expect(ad).toMatchObject({
      afterIndex: 5, campaignId: id, surface: "following", label: "Sponsored", headline: "Fall drop",
      ctaLabel: "Shop now", mediaKind: "photos",
      destination: { kind: "product", productId, sellerId: SELLER },
      seller: { id: SELLER, displayName: "North Fleece" },
      product: { id: productId, name: "Fleece hoodie", priceCents: 6_400 },
    });
    expect(ad.mediaUrls[0]).toContain(`/objects/ad-campaigns/${id}/a`);
    expect(typeof ad.token).toBe("string");

    // Never the first item, and nothing when fewer than 6 organic items.
    expect(await serve(BUYER, "following", newSession(), 5)).toEqual([]);
    // Never repeated within the same session.
    expect(await serve(BUYER, "following", s1, 6, 6)).toEqual([]);

    // Impression billed once; the same token can't bill twice.
    const imp1 = await call(BUYER, "POST", "/api/ads/impression", { token: ad.token });
    expect(imp1.body).toEqual({ counted: true, campaignCompleted: false });
    const dup = await call(BUYER, "POST", "/api/ads/impression", { token: ad.token });
    expect(dup.body).toMatchObject({ counted: false, reason: "already_counted" });
    // A token is bound to the viewer it was served to.
    expect((await call(B3, "POST", "/api/ads/impression", { token: ad.token })).body).toMatchObject({ counted: false, reason: "not_served" });
    expect((await call(BUYER, "POST", "/api/ads/impression", { token: "x".repeat(32) })).body).toMatchObject({ counted: false, reason: "not_served" });
    expect((await call(BUYER, "POST", "/api/ads/impression", {})).status).toBe(400);

    // For You + Discover (new sessions).
    const forYou = await serve(BUYER, "for_you");
    const discover = await serve(BUYER, "discover");
    expect(forYou).toHaveLength(1);
    expect(discover).toHaveLength(1);
    // Daily frequency cap: 3 serves per viewer per rolling 24h.
    expect(await serve(BUYER, "discover")).toEqual([]);
    // Another buyer is unaffected by BUYER's cap.
    expect(await serve(B3, "for_you")).toHaveLength(1);

    expect((await call(BUYER, "POST", "/api/ads/impression", { token: forYou[0].token })).body.counted).toBe(true);
    expect((await call(BUYER, "POST", "/api/ads/impression", { token: discover[0].token })).body.counted).toBe(true);

    // Click → destination; deduped per impression.
    const click = await call(BUYER, "POST", "/api/ads/click", { token: forYou[0].token });
    expect(click.status).toBe(200);
    expect(click.body).toEqual({ counted: true, destination: { kind: "product", productId, sellerId: SELLER } });
    expect((await call(BUYER, "POST", "/api/ads/click", { token: forYou[0].token })).body.counted).toBe(false);
    expect((await call(BUYER, "POST", "/api/ads/click", { token: "y".repeat(32) })).status).toBe(404);

    const row = await campaignRow(id);
    expect(row).toMatchObject({ status: "active", spentCents: 6, impressionsCount: 3, clicksCount: 1 });

    // Seller results.
    const results = await call(SELLER, "GET", `/api/ad-campaigns/${id}/results`);
    expect(results.status).toBe(200);
    expect(results.body.results).toMatchObject({
      impressions: 3, uniqueReach: 1, clicks: 1, ctrPercent: 33.33, spentCents: 6, budgetCents: 500, remainingCents: 494,
      attribution: { windowDays: 7, orders: 0, revenueCents: 0 },
    });
    expect(results.body.results.bySurface).toEqual([
      { surface: "following", impressions: 1, clicks: 0, spendCents: 2 },
      { surface: "for_you", impressions: 1, clicks: 1, spendCents: 2 },
      { surface: "discover", impressions: 1, clicks: 0, spendCents: 2 },
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const todayPoint = results.body.results.daily.find((d: any) => d.date === today);
    expect(todayPoint).toEqual({ date: today, impressions: 3, clicks: 1, spendCents: 6 });
    expect(results.body.results.daily.length).toBeGreaterThanOrEqual(7);
    // Results are owner-only.
    expect((await call(SELLER2, "GET", `/api/ad-campaigns/${id}/results`)).status).toBe(404);

    // List carries the summary.
    const list = await call(SELLER, "GET", "/api/ad-campaigns");
    const listed = list.body.campaigns.find((c: any) => c.id === id);
    expect(listed.results).toMatchObject({ impressions: 3, uniqueReach: 1, clicks: 1, spentCents: 6, remainingCents: 494 });
    expect(listed).toMatchObject({ spentCents: 6, impressionsCount: 3, clicksCount: 1 });

    // Attribution: a paid order for the advertised product after the click counts.
    const [order] = await db.insert(orders).values({
      ownerId: SELLER, buyerId: BUYER, orderNumber: `${P}-1`, totalCents: 6_400, subtotalCents: 6_400,
      status: "processing", paidAt: new Date(Date.now() + 1000),
    } as any).returning();
    await db.insert(orderItems).values({ orderId: order.id, variantId, productName: "Fleece hoodie", quantity: 1, priceCents: 6_400 });
    // An order from a buyer who never clicked doesn't.
    const [other] = await db.insert(orders).values({
      ownerId: SELLER, buyerId: B4, orderNumber: `${P}-2`, totalCents: 6_400, subtotalCents: 6_400, status: "processing", paidAt: new Date(),
    } as any).returning();
    await db.insert(orderItems).values({ orderId: other.id, variantId, productName: "Fleece hoodie", quantity: 1, priceCents: 6_400 });
    const attributed = await call(SELLER, "GET", `/api/ad-campaigns/${id}/results`);
    expect(attributed.body.results.attribution).toEqual({ windowDays: 7, orders: 1, revenueCents: 6_400 });
  });

  it("never serves a seller their own ad, or ads from blocked / muted / suspended sellers", async () => {
    const id = await launchCampaign({ headline: "Clearance sale" });
    expect(await serve(SELLER, "following")).toEqual([]);

    await db.insert(blocks).values({ blockerId: BUYER_BLOCKER, blockedId: SELLER });
    expect(await serve(BUYER_BLOCKER, "for_you")).toEqual([]);
    // The block is honored in both directions.
    await db.insert(blocks).values({ blockerId: SELLER, blockedId: B5 });
    expect(await serve(B5, "for_you")).toEqual([]);

    await db.insert(mutedWords).values({ userId: BUYER_MUTER, phrase: "clearance" });
    expect(await serve(BUYER_MUTER, "discover")).toEqual([]);

    expect(await serve(B4, "following")).toHaveLength(1);
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.clerkId, SELLER));
    try {
      expect(await serve(B4, "for_you")).toEqual([]);
    } finally {
      await db.update(users).set({ suspendedAt: null }).where(eq(users.clerkId, SELLER));
    }
    expect((await campaignRow(id)).status).toBe("active");
    await db.delete(blocks).where(inArray(blocks.blockerId, [BUYER_BLOCKER, SELLER]));
    await db.delete(mutedWords).where(eq(mutedWords.userId, BUYER_MUTER));
  });

  it("only serves on the surfaces the campaign targets", async () => {
    await launchCampaign({ surfaces: ["discover"] });
    expect(await serve(B3, "following")).toEqual([]);
    expect(await serve(B3, "for_you")).toEqual([]);
    expect(await serve(B3, "discover")).toHaveLength(1);
  });

  it("pause stops serving, resume restores it, stop completes it for good", async () => {
    const id = await launchCampaign({ cta: "learn_more" });
    const served = await serve(B3, "following");
    expect(served).toHaveLength(1);
    expect(served[0].destination).toEqual({ kind: "store", sellerId: SELLER });

    const paused = await call(SELLER, "POST", `/api/ad-campaigns/${id}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.campaign.status).toBe("paused");
    expect(await serve(B4, "following")).toEqual([]);
    // A token served before the pause can't bill while paused.
    expect((await call(B3, "POST", "/api/ads/impression", { token: served[0].token })).body).toMatchObject({ counted: false, reason: "not_active" });
    expect((await call(SELLER, "POST", `/api/ad-campaigns/${id}/pause`)).status).toBe(409);
    // Only the owner can change it.
    expect((await call(SELLER2, "POST", `/api/ad-campaigns/${id}/resume`)).status).toBe(404);
    // A running campaign can't be deleted.
    expect((await call(SELLER, "DELETE", `/api/ad-campaigns/${id}`)).status).toBe(409);

    const resumed = await call(SELLER, "POST", `/api/ad-campaigns/${id}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.campaign.status).toBe("active");
    expect(await serve(B4, "following")).toHaveLength(1);

    const stopped = await call(SELLER, "POST", `/api/ad-campaigns/${id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.campaign).toMatchObject({ status: "completed", completionReason: "seller_stopped" });
    expect(await serve(B5, "following")).toEqual([]);
    expect((await call(SELLER, "POST", `/api/ad-campaigns/${id}/resume`)).body.code).toBe("already_completed");
  });

  it("won't resume a paused campaign past its end date, and completes ended campaigns", async () => {
    const id = await launchCampaign();
    await call(SELLER, "POST", `/api/ad-campaigns/${id}/pause`);
    await db.update(adCampaigns).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(adCampaigns.id, id));
    const resume = await call(SELLER, "POST", `/api/ad-campaigns/${id}/resume`);
    expect(resume.status).toBe(409);
    // The resume call's lazy sweep already completed it as ended.
    expect(await campaignRow(id)).toMatchObject({ status: "completed", completionReason: "ended" });

    const id2 = await launchCampaign();
    await db.update(adCampaigns).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(adCampaigns.id, id2));
    expect(await serve(B3, "for_you")).toEqual([]);
    expect(await completeEndedAdCampaigns(new Date())).toBeGreaterThanOrEqual(1);
    expect(await campaignRow(id2)).toMatchObject({ status: "completed", completionReason: "ended" });
  });

  it("completes the campaign when the budget is spent and stops serving immediately", async () => {
    const id = await launchCampaign({ budgetCents: 6 }); // 3 impressions at 2¢
    const tokens: string[] = [];
    for (const buyer of [BUYER, B3, B4, B5]) {
      const ads = await serve(buyer, "for_you");
      expect(ads).toHaveLength(1);
      tokens.push(ads[0].token);
    }
    const results = [];
    for (const [i, token] of tokens.entries()) {
      results.push((await call([BUYER, B3, B4, B5][i], "POST", "/api/ads/impression", { token })).body);
    }
    expect(results.slice(0, 2)).toEqual([{ counted: true, campaignCompleted: false }, { counted: true, campaignCompleted: false }]);
    expect(results[2]).toEqual({ counted: true, campaignCompleted: true });
    expect(results[3]).toMatchObject({ counted: false, reason: "not_active" });

    expect(await campaignRow(id)).toMatchObject({ status: "completed", completionReason: "budget_spent", spentCents: 6, impressionsCount: 3 });
    expect(await serve(BUYER_MUTER, "for_you")).toEqual([]);
    // Seller can't resume a campaign that spent its budget.
    expect((await call(SELLER, "POST", `/api/ad-campaigns/${id}/resume`)).status).toBe(409);
  });

  it("concurrent impression confirmations never overspend the budget", async () => {
    const id = await launchCampaign({ budgetCents: 10 }); // 5 impressions
    const served: { buyer: string; token: string }[] = [];
    for (const buyer of [BUYER, B3, B4, B5]) {
      for (let i = 0; i < 3; i += 1) {
        const ads = await serve(buyer, "discover");
        expect(ads).toHaveLength(1);
        served.push({ buyer, token: ads[0].token });
      }
    }
    expect(served).toHaveLength(12);
    const outcomes = await Promise.all(served.map((s) => call(s.buyer, "POST", "/api/ads/impression", { token: s.token })));
    expect(outcomes.every((o) => o.status === 200)).toBe(true);
    expect(outcomes.filter((o) => o.body.counted === true)).toHaveLength(5);

    const row = await campaignRow(id);
    expect(row).toMatchObject({ spentCents: 10, impressionsCount: 5, status: "completed", completionReason: "budget_spent" });
    const billed = await db.select().from(adImpressions).where(eq(adImpressions.campaignId, id));
    expect(billed.reduce((sum, r) => sum + r.billedCents, 0)).toBe(10);
    expect(billed.filter((r) => r.viewedAt !== null)).toHaveLength(5);
  });

  it("a click on an unconfirmed impression bills it first (if budget allows) and counts once", async () => {
    const id = await launchCampaign();
    const [ad] = await serve(B4, "following");
    const click = await call(B4, "POST", "/api/ads/click", { token: ad.token });
    expect(click.body.counted).toBe(true);
    expect(await campaignRow(id)).toMatchObject({ impressionsCount: 1, clicksCount: 1, spentCents: 2 });
    const clicks = await db.select().from(adClicks).where(eq(adClicks.campaignId, id));
    expect(clicks).toHaveLength(1);
    expect(clicks[0].surface).toBe("following");
  });

  it("rejects bad serve requests", async () => {
    expect((await call(BUYER, "GET", "/api/ads/serve?surface=home&sessionId=abcdefgh12&organicCount=6&organicOffset=0")).status).toBe(400);
    expect((await call(BUYER, "GET", "/api/ads/serve?surface=following&organicCount=6&organicOffset=0")).status).toBe(400);
    const anon = await fetch(`${base}/api/ads/serve?surface=following&sessionId=abcdefgh12&organicCount=6&organicOffset=0`);
    expect(anon.status).toBe(401);
  });
});
