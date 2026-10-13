/**
 * Admin Metrics, real DB + real routers. Numbers are checked by calling the
 * metric functions over a window in 2001, where only this file's rows live, so
 * other data in the shared test database can't move them. The HTTP layer is
 * checked for the admin gate and response shape.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { randomUUID } from "node:crypto";
import { eq, inArray, like, sql } from "drizzle-orm";
import { appInstalls, db, disputes, orderItems, orders, posts, productVariants, products, users } from "@workspace/db";

vi.hoisted(() => {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";
});

vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));
let signedInAs: string | null = null;
vi.mock("@clerk/express", async (orig) => ({
  ...(await orig<typeof import("@clerk/express")>()),
  getAuth: () => ({ userId: signedInAs }),
}));

import adminRouter from "../admin";
import appInstallsRouter from "../app-installs";
import {
  acquisitionFunnel, inactiveSellers, repeatBuyerCohorts, salesTotals, sellerRefundChargebackRates,
  topProducts, topSellers,
} from "../../lib/admin/launchMetrics";

const P = `amx${process.pid}`;
const U = (s: string) => `${P}-${s}`;
const ADMIN = U("admin"), SELLER_A = U("sellerA"), SELLER_B = U("sellerB"), QUIET = U("quiet"), REVIEW = U("review");
const BUYERS = [1, 2, 3, 4].map((i) => U(`buyer${i}`));
const D = (iso: string) => new Date(iso);
const MARCH = { from: D("2001-03-01T00:00:00Z"), to: D("2001-04-01T00:00:00Z") };

let server: Server;
let base = "";
const installIds = [randomUUID(), randomUUID(), randomUUID()];
const httpInstall = randomUUID();

const call = (user: string | null, path: string, init: RequestInit = {}) =>
  fetch(`${base}/api${path}`, { ...init, headers: { "content-type": "application/json", ...(user ? { "x-test-acting-as": user } : {}) } });

beforeAll(async () => {
  const mk = (clerkId: string, extra: Partial<typeof users.$inferInsert> = {}) => ({
    clerkId, email: `${clerkId}@example.test`, name: clerkId, ...extra,
  });
  await db.insert(users).values([
    mk(ADMIN, { role: "admin" }),
    mk(SELLER_A, { accountType: "seller", brandName: "Alpha", createdAt: D("2001-01-05T00:00:00Z") }),
    mk(SELLER_B, { accountType: "seller", brandName: "Bravo", createdAt: D("2001-01-05T00:00:00Z") }),
    mk(QUIET, { accountType: "seller", brandName: "Quiet", createdAt: D("2000-12-01T00:00:00Z") }),
    mk(REVIEW, { accountType: "seller", brandName: "Reviewer", isReviewAccount: true, createdAt: D("2001-03-02T00:00:00Z") }),
    ...BUYERS.map((b) => mk(b, { accountType: "buyer", createdAt: D("2001-03-02T00:00:00Z") })),
  ]);

  const [prodA] = await db.insert(products).values({ ownerId: SELLER_A, name: `${P} Hoodie`, status: "active", updatedAt: D("2001-03-30T00:00:00Z") }).returning();
  const [prodB] = await db.insert(products).values({ ownerId: SELLER_B, name: `${P} Tee`, status: "active", updatedAt: D("2001-03-30T00:00:00Z") }).returning();
  await db.insert(products).values({ ownerId: QUIET, name: `${P} Old cap`, status: "active", updatedAt: D("2001-03-01T00:00:00Z"), createdAt: D("2001-03-01T00:00:00Z") });
  const [varA] = await db.insert(productVariants).values({ productId: prodA!.id, sku: `${P}-A`, priceCents: 10_000 }).returning();
  const [varB] = await db.insert(productVariants).values({ productId: prodB!.id, sku: `${P}-B`, priceCents: 3_000 }).returning();

  const order = (n: number, ownerId: string, buyerId: string | null, paidAt: string, extra: Partial<typeof orders.$inferInsert> = {}) => ({
    ownerId, buyerId, orderNumber: `${P}-${n}`, totalCents: 10_000, subtotalCents: 10_000, platformFeeCents: 500,
    status: "shipped", paidAt: D(paidAt), ...extra,
  });
  const inserted = await db.insert(orders).values([
    // buyer1: first buy Mar 3, again Mar 20 (repeat within 30 days)
    order(1, SELLER_A, BUYERS[0]!, "2001-03-03T12:00:00Z"),
    order(2, SELLER_A, BUYERS[0]!, "2001-03-20T12:00:00Z"),
    // buyer2: one buy, partially refunded
    order(3, SELLER_A, BUYERS[1]!, "2001-03-05T12:00:00Z", { refundedCents: 2_000, platformFeeRefundedCents: 100 }),
    // buyer3: bought from B, then again 40 days later (not a 30-day repeat)
    order(4, SELLER_B, BUYERS[2]!, "2001-03-06T12:00:00Z", { totalCents: 3_000, subtotalCents: 3_000, platformFeeCents: 150 }),
    order(5, SELLER_B, BUYERS[2]!, "2001-04-15T12:00:00Z", { totalCents: 3_000, subtotalCents: 3_000, platformFeeCents: 150 }),
    // guest checkout counts as a buyer by email
    order(6, SELLER_B, null, "2001-03-07T12:00:00Z", { guestEmail: `${P}-Guest@Example.test`, totalCents: 3_000, subtotalCents: 3_000, platformFeeCents: 150 }),
    // cancelled and unpaid orders never count
    order(7, SELLER_A, BUYERS[3]!, "2001-03-08T12:00:00Z", { status: "cancelled" }),
    { ...order(8, SELLER_A, BUYERS[3]!, "2001-03-08T12:00:00Z"), paidAt: null },
    // App Review seller's sale is excluded
    order(9, REVIEW, BUYERS[3]!, "2001-03-09T12:00:00Z"),
    // quiet seller's last sale, long ago
    order(10, QUIET, BUYERS[3]!, "2001-02-01T12:00:00Z"),
  ]).returning();
  const byNum = new Map(inserted.map((o) => [o.orderNumber, o]));
  await db.insert(orderItems).values([
    { orderId: byNum.get(`${P}-1`)!.id, variantId: varA!.id, productName: "Hoodie", quantity: 1, priceCents: 10_000 },
    { orderId: byNum.get(`${P}-2`)!.id, variantId: varA!.id, productName: "Hoodie", quantity: 1, priceCents: 10_000 },
    { orderId: byNum.get(`${P}-3`)!.id, variantId: varA!.id, productName: "Hoodie", quantity: 1, priceCents: 10_000 },
    { orderId: byNum.get(`${P}-4`)!.id, variantId: varB!.id, productName: "Tee", quantity: 1, priceCents: 3_000 },
    { orderId: byNum.get(`${P}-6`)!.id, variantId: varB!.id, productName: "Tee", quantity: 1, priceCents: 3_000 },
  ]);
  await db.insert(disputes).values({
    stripeDisputeId: `${P}-dp1`, orderId: byNum.get(`${P}-4`)!.id, sellerId: SELLER_B, amountCents: 3_000,
  });
  await db.insert(posts).values({ userId: SELLER_B, mediaUrl: "https://example.test/p.jpg", createdAt: D("2001-03-29T00:00:00Z") } as any);

  await db.insert(appInstalls).values([
    { installId: installIds[0]!, platform: "ios", firstSeenAt: D("2001-03-02T00:00:00Z"), clerkId: BUYERS[0]! },
    { installId: installIds[1]!, platform: "ios", firstSeenAt: D("2001-03-02T00:00:00Z"), clerkId: BUYERS[3]! },
    { installId: installIds[2]!, platform: "android", firstSeenAt: D("2001-03-02T00:00:00Z") },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/admin", adminRouter);
  app.use("/api/app/installs", appInstallsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(disputes).where(like(disputes.stripeDisputeId, `${P}-%`));
  await db.delete(orders).where(like(orders.orderNumber, `${P}-%`));
  await db.delete(posts).where(like(posts.userId, `${P}-%`));
  await db.delete(products).where(like(products.ownerId, `${P}-%`));
  await db.delete(appInstalls).where(inArray(appInstalls.installId, [...installIds, httpInstall]));
  await db.delete(users).where(like(users.clerkId, `${P}-%`));
});

describe("admin gate", () => {
  it("serves every metrics route to admins only", async () => {
    const paths = ["/today", "/cohorts", "/top", "/funnel", "/seller-risk", "/inactive-sellers"];
    for (const p of paths) {
      expect((await call(null, `/admin/metrics${p}`)).status).toBe(401);
      expect((await call(SELLER_A, `/admin/metrics${p}`)).status).toBe(403);
      expect((await call(ADMIN, `/admin/metrics${p}`)).status).toBe(200);
    }
  });

  it("returns today with yesterday for comparison", async () => {
    const body: any = await (await call(ADMIN, "/admin/metrics/today")).json();
    expect(body.timeZone).toBe("America/Chicago");
    for (const k of ["gmvCents", "feesCents", "orders", "newBuyers", "signups", "activeSellers"]) {
      expect(typeof body.today[k]).toBe("number");
      expect(typeof body.yesterday[k]).toBe("number");
    }
  });

  it("never sends seller emails to the dashboard", async () => {
    const body = await (await call(ADMIN, "/admin/metrics/inactive-sellers")).json();
    expect(JSON.stringify(body)).not.toContain("@example.test");
  });
});

describe("numbers", () => {
  it("totals GMV, net fees, orders, new buyers and sign-ups for a window", async () => {
    const t = await salesTotals(MARCH);
    // Orders 1,2,3 (10k each) + 4,6 (3k each); cancelled, unpaid and App Review excluded.
    expect(t.gmvCents).toBe(36_000);
    expect(t.feesCents).toBe(500 * 3 - 100 + 150 * 2);
    expect(t.orders).toBe(5);
    // buyer1, buyer2, buyer3, guest. buyer4's first sale was in February.
    expect(t.newBuyers).toBe(4);
    expect(t.signups).toBe(4); // the 4 buyers; the App Review seller is excluded
  });

  it("computes 30-day repeat cohorts by first-purchase month", async () => {
    const cohorts = await repeatBuyerCohorts(D("2001-05-15T00:00:00Z"), 3);
    const march = cohorts.find((c) => c.month === "2001-03")!;
    expect(march).toMatchObject({ buyers: 4, repeatBuyers: 1, maturing: false });
    expect(march.repeatRate).toBeCloseTo(0.25);
  });

  it("marks a cohort maturing until its buyers have had 30 days", async () => {
    const cohorts = await repeatBuyerCohorts(D("2001-03-25T00:00:00Z"), 1);
    const march = cohorts.find((c) => c.month === "2001-03")!;
    expect(march.maturing).toBe(true);
    expect(march.buyers).toBe(4);
  });

  it("ranks top sellers and products by sales", async () => {
    const sellers = (await topSellers(MARCH)).filter((s) => s.clerkId.startsWith(P));
    expect(sellers.map((s) => s.name)).toEqual(["Alpha", "Bravo"]);
    expect(sellers[0]).toMatchObject({ orders: 3, gmvCents: 30_000 });
    const products = (await topProducts(MARCH)).filter((p) => p.name.startsWith(P));
    expect(products[0]).toMatchObject({ name: `${P} Hoodie`, units: 3, revenueCents: 30_000, seller: "Alpha" });
    expect(products[1]).toMatchObject({ name: `${P} Tee`, units: 2 });
  });

  it("builds the install → sign-up → first purchase funnel", async () => {
    const f = await acquisitionFunnel(MARCH);
    // 3 installs, 2 signed in; buyer1 purchased, buyer4 only bought from the excluded/quiet path
    expect(f.installs).toEqual({ installs: 3, signedUp: 2, purchased: 2 });
    expect(f.signups.signups).toBe(4);
    expect(f.signups.purchased).toBe(4);
  });

  it("flags sellers above a 2% refund or chargeback rate", async () => {
    const rows = (await sellerRefundChargebackRates(MARCH)).filter((s) => s.clerkId.startsWith(P));
    const a = rows.find((r) => r.clerkId === SELLER_A)!;
    const b = rows.find((r) => r.clerkId === SELLER_B)!;
    expect(a).toMatchObject({ orders: 3, refundedOrders: 1, chargebacks: 0, flagged: true });
    expect(a.refundRate).toBeCloseTo(1 / 3);
    expect(b).toMatchObject({ orders: 2, refundedOrders: 0, chargebacks: 1, flagged: true });
    expect(b.chargebackRate).toBeCloseTo(0.5);
  });

  it("lists sellers with no activity for 14+ days, not ones still active", async () => {
    const list = (await inactiveSellers(D("2001-04-05T00:00:00Z"))).filter((s) => s.clerkId.startsWith(P));
    // Quiet: last product edit Mar 1 → 35 days. Alpha/Bravo edited products on Mar 30.
    expect(list.map((s) => s.clerkId)).toEqual([QUIET]);
    expect(list[0]).toMatchObject({ daysInactive: 35, activeProducts: 1 });
  });
});

describe("POST /app/installs", () => {
  it("records an install signed out, then links the first account that signs in", async () => {
    signedInAs = null;
    const first = await call(null, "/app/installs", { method: "POST", body: JSON.stringify({ installId: httpInstall, platform: "ios", appVersion: "1.0.0" }) });
    expect(first.status).toBe(204);
    signedInAs = BUYERS[1]!;
    await call(null, "/app/installs", { method: "POST", body: JSON.stringify({ installId: httpInstall, platform: "ios" }) });
    signedInAs = BUYERS[2]!;
    await call(null, "/app/installs", { method: "POST", body: JSON.stringify({ installId: httpInstall, platform: "ios", appVersion: "1.0.1" }) });
    const [row] = await db.select().from(appInstalls).where(eq(appInstalls.installId, httpInstall));
    expect(row).toMatchObject({ platform: "ios", appVersion: "1.0.1", clerkId: BUYERS[1] });
    expect(row!.signedInAt).toBeInstanceOf(Date);
    signedInAs = null;
  });

  it("rejects a malformed install id", async () => {
    const res = await call(null, "/app/installs", { method: "POST", body: JSON.stringify({ installId: "abc" }) });
    expect(res.status).toBe(400);
    const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM app_installs WHERE install_id = 'abc'`) as any).rows;
    expect(n).toBe(0);
  });
});
