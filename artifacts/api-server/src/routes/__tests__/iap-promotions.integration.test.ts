/**
 * Native (store) rail for promotions against a real database: Featured slots
 * bought through RevenueCat, store purchases returned as credit when a
 * promotion is rejected, credit applied to the next promotion, the review gate
 * on IAP boosts, and the RevenueCat webhook never acknowledging a purchase it
 * did not process. RevenueCat's REST lookup, Clerk and Stripe are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { boosts, db, featuredSlots, iapPromotionPurchases, posts, revenueCatWebhookEvents, users } from "@workspace/db";

const rc = vi.hoisted(() => ({ purchases: new Map<string, { productId: string; transactionId: string }>() }));

vi.mock("@clerk/express", () => ({ getAuth: (req: any) => ({ userId: req.headers["x-test-user"] ?? null }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers["x-test-user"]) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: any) => next(),
  requireModerator: async (req: any, res: any, next: any) => {
    const { db: database, users: usersTable } = await import("@workspace/db");
    const { eq: equals } = await import("drizzle-orm");
    const [u] = await database.select({ role: usersTable.role }).from(usersTable)
      .where(equals(usersTable.clerkId, req.clerkUserId)).limit(1);
    if (u?.role !== "admin") return res.status(403).json({ error: "Moderator access required" });
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({ requirePermission: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../lib/stripe", () => ({
  requireStripe: () => { throw new Error("Stripe must not be called for store purchases"); },
  stripe: null,
  STRIPE_WEBHOOK_SECRET: "",
}));
vi.mock("../../lib/nativeEntitlements", () => ({
  getEffectiveEntitlement: vi.fn(async () => ({ planId: "pro", provider: "revenuecat" })),
  reconcileRevenueCatEntitlement: vi.fn(async () => undefined),
}));
vi.mock("../../lib/iapPromotionsStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/iapPromotionsStore")>()),
  lookupRevenueCatPurchase: vi.fn(async (_user: string, tx: string) => rc.purchases.get(tx) ?? null),
}));

const tag = crypto.randomUUID().slice(0, 8);
const admin = `iap-admin-${tag}`;
const seller = `iap-seller-${tag}`;
const RC_AUTH = "Bearer test-rc-secret";
let server: Server;
let base = "";
let postId = "";

async function call(user: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Pretend the store sold this product and RevenueCat has the receipt. */
function storeSale(productId: string) {
  const transactionId = `tx_${crypto.randomUUID()}`;
  rc.purchases.set(transactionId, { productId, transactionId });
  return transactionId;
}

/** Credit only becomes spendable once its own grant attempt has settled. */
async function ageCredit(transactionId: string) {
  await db.update(iapPromotionPurchases)
    .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
    .where(eq(iapPromotionPurchases.transactionId, transactionId));
}

beforeAll(async () => {
  delete process.env.PROMOTION_REVIEW_REQUIRED;
  delete process.env.IAP_PROMOTIONS_ENABLED;
  process.env.REVENUECAT_WEBHOOK_AUTHORIZATION = RC_AUTH;
  const { default: iapRouter } = await import("../iap-promotions");
  const { default: featuredRouter } = await import("../featured-slots");
  const { default: boostsRouter } = await import("../boosts");
  const { default: adminRouter } = await import("../admin-promotions");
  const { default: webhooksRouter } = await import("../webhooks");
  const app = express();
  const noop = () => {};
  app.use((req: any, _res, next) => { req.log = { warn: noop, error: noop, info: noop }; next(); });
  app.use("/api/webhooks", express.json(), webhooksRouter);
  app.use(express.json());
  app.use("/api/iap-promotions", iapRouter);
  app.use("/api/featured-slots", featuredRouter);
  app.use("/api/boosts", boostsRouter);
  app.use("/api/admin/promotions", adminRouter);

  await db.insert(users).values([
    { clerkId: admin, email: `${admin}@test.local`, name: "Admin", role: "admin", accountType: "seller" },
    { clerkId: seller, email: `${seller}@test.local`, name: "Seller", brandName: "Brand", role: "seller", accountType: "seller" },
  ]);
  [{ id: postId }] = await db.insert(posts).values({
    userId: seller, mediaUrl: "https://cdn.test/a.mp4", mediaType: "video", postStatus: "published", caption: "drop",
  }).returning({ id: posts.id });

  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(iapPromotionPurchases).where(eq(iapPromotionPurchases.appUserId, seller));
  await db.delete(revenueCatWebhookEvents).where(eq(revenueCatWebhookEvents.appUserId, seller));
  await db.delete(boosts).where(eq(boosts.sellerId, seller));
  await db.delete(featuredSlots).where(eq(featuredSlots.sellerId, seller));
  await db.delete(posts).where(eq(posts.userId, seller));
  await db.delete(users).where(inArray(users.clerkId, [admin, seller]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  delete process.env.IAP_PROMOTIONS_ENABLED;
  await db.delete(iapPromotionPurchases).where(eq(iapPromotionPurchases.appUserId, seller));
  await db.delete(featuredSlots).where(eq(featuredSlots.sellerId, seller));
});

describe("Featured on Discover through the store", () => {
  it("lists Featured products in the native config", async () => {
    const config = await call(seller, "GET", "/api/iap-promotions/config");
    expect(config.body.enabled).toBe(true);
    expect(config.body.products).toEqual(expect.arrayContaining(["brandthread_featured_3d", "brandthread_featured_7d", "brandthread_featured_14d"]));
  });

  it("moves a paid slot to review, then returns the charge as credit when rejected", async () => {
    const slot = await call(seller, "POST", "/api/featured-slots", { durationDays: 7 });
    expect(slot.status).toBe(201);
    const tx = storeSale("brandthread_featured_7d");

    const verified = await call(seller, "POST", `/api/iap-promotions/featured/${slot.body.id}/verify`, { transactionId: tx });
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ status: "granted", kind: "featured_slot", targetId: slot.body.id });
    const [paid] = await db.select().from(featuredSlots).where(eq(featuredSlots.id, slot.body.id));
    expect(paid.status).toBe("in_review");
    expect(paid.paidAt).toBeTruthy();

    // Replaying the same receipt is idempotent.
    const again = await call(seller, "POST", `/api/iap-promotions/featured/${slot.body.id}/verify`, { transactionId: tx });
    expect(again.body.status).toBe("already_granted");

    const rejected = await call(admin, "POST", `/api/admin/promotions/featured/${slot.body.id}/reject`, { reason: "Brand not eligible" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.refundStatus).toBe("credited");
    const [purchase] = await db.select().from(iapPromotionPurchases).where(eq(iapPromotionPurchases.transactionId, tx));
    expect(purchase.grantedAt).toBeNull();
    expect(purchase.targetId).toBeNull();

    await ageCredit(tx);
    const credits = await call(seller, "GET", "/api/iap-promotions/credits");
    expect(credits.body.credits).toEqual([{ kind: "featured_slot", amountCents: 5900, productId: "brandthread_featured_7d" }]);

    // The next 7-day slot is paid with that credit; nothing is charged again.
    const next = await call(seller, "POST", "/api/featured-slots", { durationDays: 7 });
    const applied = await call(seller, "POST", `/api/iap-promotions/featured/${next.body.id}/apply-credit`);
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ status: "granted", transactionId: tx, targetId: next.body.id });
    const [nextRow] = await db.select().from(featuredSlots).where(eq(featuredSlots.id, next.body.id));
    expect(nextRow.status).toBe("in_review");
    expect((await call(seller, "GET", "/api/iap-promotions/credits")).body.credits).toEqual([]);
  });

  it("never spends credit of a different length, or a purchase still being granted", async () => {
    const slot = await call(seller, "POST", "/api/featured-slots", { durationDays: 3 });
    const tx = storeSale("brandthread_featured_7d");
    // Bought but unmatched (e.g. the slot was withdrawn): kept as credit, not yet settled.
    await db.insert(iapPromotionPurchases).values({
      transactionId: tx, appUserId: seller, productId: "brandthread_featured_7d", kind: "featured_slot", amountCents: 5900, source: "webhook",
    });
    expect((await call(seller, "POST", `/api/iap-promotions/featured/${slot.body.id}/apply-credit`)).status).toBe(404);
    await ageCredit(tx);
    expect((await call(seller, "POST", `/api/iap-promotions/featured/${slot.body.id}/apply-credit`)).body.status).toBe("no_credit");
  });

  it("refuses buyers", async () => {
    const buyer = `iap-buyer-${tag}`;
    await db.insert(users).values({ clerkId: buyer, email: `${buyer}@test.local`, name: "B", role: "buyer", accountType: "buyer" });
    try {
      const res = await call(buyer, "POST", "/api/iap-promotions/featured/00000000-0000-0000-0000-000000000000/verify", { transactionId: "tx" });
      expect(res.status).toBe(403);
    } finally {
      await db.delete(users).where(eq(users.clerkId, buyer));
    }
  });
});

describe("boosts through the store", () => {
  it("keeps the review gate: a store-paid boost waits for approval", async () => {
    const created = await call(seller, "POST", "/api/boosts", { targetType: "post", targetId: postId, budgetCents: 2500, durationDays: 7 });
    expect(created.status).toBe(201);
    const tx = storeSale("brandthread_boost_25");
    const verified = await call(seller, "POST", `/api/iap-promotions/boost/${created.body.id}/verify`, { transactionId: tx });
    expect(verified.body.status).toBe("granted");
    const [row] = await db.select().from(boosts).where(eq(boosts.id, created.body.id));
    expect(row.status).toBe("in_review");
    expect(row.startsAt).toBeNull();

    const rejected = await call(admin, "POST", `/api/admin/promotions/boosts/${created.body.id}/reject`, { reason: "Not allowed" });
    expect(rejected.status).toBe(200);
    const [after] = await db.select().from(boosts).where(eq(boosts.id, created.body.id));
    expect(after.refundStatus).toBe("credited");
  });
});

describe("RevenueCat webhook for promotion purchases", () => {
  const event = (tx: string) => ({
    id: `evt_${crypto.randomUUID()}`, type: "NON_RENEWING_PURCHASE", app_user_id: seller,
    transaction_id: tx, product_id: "brandthread_featured_14d", event_timestamp_ms: Date.now(),
  });

  it("answers 503 and keeps nothing while paused, so RevenueCat retries", async () => {
    process.env.IAP_PROMOTIONS_ENABLED = "false";
    const e = event(`tx_${crypto.randomUUID()}`);
    const res = await call(null, "POST", "/api/webhooks/revenuecat", { event: e }, { authorization: RC_AUTH });
    expect(res.status).toBe(503);
    expect(await db.select().from(revenueCatWebhookEvents).where(eq(revenueCatWebhookEvents.eventId, e.id))).toHaveLength(0);

    delete process.env.IAP_PROMOTIONS_ENABLED;
    const retry = await call(null, "POST", "/api/webhooks/revenuecat", { event: e }, { authorization: RC_AUTH });
    expect(retry.status).toBe(200);
    expect(retry.body.promotion).toBe("unmatched");
    const [purchase] = await db.select().from(iapPromotionPurchases).where(eq(iapPromotionPurchases.transactionId, e.transaction_id));
    expect(purchase.grantedAt).toBeNull(); // kept as credit
  });

  it("grants the seller's pending slot when the webhook lands first", async () => {
    const slot = await call(seller, "POST", "/api/featured-slots", { durationDays: 14 });
    const e = event(`tx_${crypto.randomUUID()}`);
    const res = await call(null, "POST", "/api/webhooks/revenuecat", { event: e }, { authorization: RC_AUTH });
    expect(res.body.promotion).toBe("granted");
    const [row] = await db.select().from(featuredSlots).where(eq(featuredSlots.id, slot.body.id));
    expect(row.status).toBe("in_review");
  });
});
