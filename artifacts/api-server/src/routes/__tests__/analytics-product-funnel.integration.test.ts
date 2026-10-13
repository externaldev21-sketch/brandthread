/**
 * GET /api/analytics/insights/products/:productId — one product's real
 * views → added to bag → reached checkout → purchased funnel, revenue by day,
 * best size / colour / variant from order lines, return and sell-through
 * rates. Checks auth, ownership (404 for another seller's product), seller
 * isolation of every count, the previous-period comparison and the empty
 * response.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db, users, products, productVariants, orders, orderItems, storeVisits, sellerProductEvents, checkoutSessions, returns,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const A = `pf-a-${sfx}`;
const B = `pf-b-${sfx}`;
const BUYER = `pf-buyer-${sfx}`;

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: authState.clerkUserId }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_q: unknown, _r: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";
let tee = "";
let quiet = "";
let hoodieB = "";
const v: Record<string, string> = {};

const get = (path: string, as: string | null = A) => {
  authState.clerkUserId = as;
  return fetch(`${base}/api/analytics/insights${path}`);
};
const json = async (r: Response) => (await r.json()) as any;
const TZ = -new Date().getTimezoneOffset();
const justNow = () => new Date(Date.now() - 5_000);
const yesterday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() - 60_000); };

async function order(owner: string, lines: { variantId: string; quantity: number; priceCents: number }[], createdAt = justNow(), extra: Partial<typeof orders.$inferInsert> = {}) {
  const total = lines.reduce((a, l) => a + l.quantity * l.priceCents, 0);
  const [o] = await db.insert(orders).values({
    ownerId: owner, buyerId: BUYER, orderNumber: `PF-${crypto.randomBytes(4).toString("hex")}`,
    totalCents: total, subtotalCents: total, status: "processing", paidAt: createdAt, createdAt, ...extra,
  }).returning();
  const items = await db.insert(orderItems).values(lines.map((l) => ({ orderId: o.id, productName: "P", ...l }))).returning();
  return { order: o, items };
}

beforeAll(async () => {
  await db.insert(users).values([A, B, BUYER].map((id) => ({
    clerkId: id, email: `${id}@test.local`, name: id, role: id === BUYER ? "buyer" : "seller", accountType: id === BUYER ? "buyer" : "seller",
  })));
  const [t, qp, hb] = await db.insert(products).values([
    { ownerId: A, name: "Boxy Tee" },
    { ownerId: A, name: "Quiet Cap" },
    { ownerId: B, name: "B Hoodie" },
  ]).returning();
  tee = t.id; quiet = qp.id; hoodieB = hb.id;
  const vs = await db.insert(productVariants).values([
    { productId: tee, sku: `PF-M-BLK-${sfx}`, size: "M", color: "Black", priceCents: 3000, stock: 4 },
    { productId: tee, sku: `PF-L-BLK-${sfx}`, size: "L", color: "Black", priceCents: 3000, stock: 2 },
    { productId: tee, sku: `PF-S-WHT-${sfx}`, size: "S", color: "White", priceCents: 3000, stock: 0 },
    { productId: quiet, sku: `PF-CAP-${sfx}`, priceCents: 2000, stock: 5 },
    { productId: hoodieB, sku: `PF-HB-${sfx}`, size: "M", color: "Black", priceCents: 9000, stock: 1 },
  ]).returning();
  [v.m, v.l, v.s, v.cap, v.hb] = vs.map((x) => x.id);

  // Today: 20 views of the tee (3 by one signed-in buyer), 6 add-to-bags,
  // 4 checkouts, 3 paid orders (one with two lines of the tee + a cap line).
  await db.insert(storeVisits).values([
    ...Array.from({ length: 17 }, () => ({ sellerId: A, productId: tee, source: "feed", createdAt: justNow() })),
    ...Array.from({ length: 3 }, () => ({ sellerId: A, productId: tee, source: "feed", viewerUserId: BUYER, createdAt: justNow() })),
    // yesterday: 10 views (previous period for "today")
    ...Array.from({ length: 10 }, () => ({ sellerId: A, productId: tee, source: "feed", createdAt: yesterday() })),
    // another seller's visit row for A's product never counts for A
    { sellerId: B, productId: tee, source: "feed", createdAt: justNow() },
  ]);
  await db.insert(sellerProductEvents).values([
    ...Array.from({ length: 6 }, (_, i) => ({ sellerId: A, productId: tee, eventType: "add_to_cart", viewerKey: `k${i}`, createdAt: justNow() })),
    { sellerId: A, productId: quiet, eventType: "add_to_cart", viewerKey: "kq", createdAt: justNow() },
  ]);
  const line = (variantId: string, quantity = 1) => ({ variantId, productName: "Boxy Tee", variantLabel: "", quantity, priceCents: 3000 });
  await db.insert(checkoutSessions).values([
    { sellerId: A, buyerId: BUYER, items: [line(v.m)], createdAt: justNow() },
    { sellerId: A, buyerId: BUYER, items: [line(v.m), line(v.l)], createdAt: justNow() }, // one checkout with two tee lines
    { sellerId: A, buyerId: BUYER, items: [line(v.s)], createdAt: justNow() },
    { sellerId: A, items: [line(v.l)], guestEmail: "g@test.local", createdAt: justNow() },
    { sellerId: A, buyerId: BUYER, items: [{ ...line(v.cap), productName: "Quiet Cap" }], createdAt: justNow() }, // cap only
  ]);
  const o1 = await order(A, [{ variantId: v.m, quantity: 2, priceCents: 3000 }, { variantId: v.l, quantity: 1, priceCents: 3000 }, { variantId: v.cap, quantity: 1, priceCents: 2000 }]);
  await order(A, [{ variantId: v.m, quantity: 1, priceCents: 3000 }]);
  await order(A, [{ variantId: v.s, quantity: 1, priceCents: 2500 }]);
  // not counted: cancelled, unpaid, and another seller's order of their own product
  await order(A, [{ variantId: v.m, quantity: 5, priceCents: 3000 }], justNow(), { status: "cancelled" });
  await order(A, [{ variantId: v.m, quantity: 5, priceCents: 3000 }], justNow(), { paidAt: null });
  await order(B, [{ variantId: v.hb, quantity: 3, priceCents: 9000 }]);
  // A return of one M tee from order 1 (pending) and a denied one that never counts.
  const mLine = o1.items.find((i) => i.variantId === v.m)!;
  const capLine = o1.items.find((i) => i.variantId === v.cap)!;
  await db.insert(returns).values([
    { id: `pf-r1-${sfx}`, orderId: o1.order.id, buyerId: BUYER, sellerId: A, reason: "size", requestedItems: [{ lineItemId: mLine.id, quantity: 1 }, { lineItemId: capLine.id, quantity: 1 }] },
    { id: `pf-r2-${sfx}`, orderId: o1.order.id, buyerId: BUYER, sellerId: A, reason: "x", status: "denied", requestedItems: [{ lineItemId: mLine.id, quantity: 2 }] },
  ]);

  const app = express();
  app.use(express.json() as any);
  const { default: insights } = await import("../analytics-insights");
  app.use("/api/analytics/insights", insights);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const sellers = [A, B];
  await db.delete(returns).where(inArray(returns.sellerId, sellers));
  await db.delete(orders).where(inArray(orders.ownerId, sellers));
  await db.delete(checkoutSessions).where(inArray(checkoutSessions.sellerId, sellers));
  await db.delete(storeVisits).where(inArray(storeVisits.sellerId, sellers));
  await db.delete(sellerProductEvents).where(inArray(sellerProductEvents.sellerId, sellers));
  await db.delete(products).where(inArray(products.ownerId, sellers));
  await db.delete(users).where(inArray(users.clerkId, [...sellers, BUYER]));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /products/:productId", () => {
  it("rejects signed-out callers", async () => {
    expect((await get(`/products/${tee}`, null)).status).toBe(401);
  });

  it("404s for another seller's product, an unknown id and a malformed id", async () => {
    expect((await get(`/products/${hoodieB}`)).status).toBe(404);
    expect((await get(`/products/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await get(`/products/not-a-uuid`)).status).toBe(404);
    expect((await get(`/products/${tee}`, B)).status).toBe(404);
  });

  it("returns the real funnel for today with step and of-views rates", async () => {
    const body = await json(await get(`/products/${tee}?range=today&tz=${TZ}`));
    expect(body.window.range).toBe("today");
    expect(body.product).toEqual({ id: tee, name: "Boxy Tee", stock: 6 });
    expect(body.totals).toMatchObject({
      views: 20, uniqueViewers: 1, addToCarts: 6, checkouts: 4, purchases: 3, units: 5, revenueCents: 4 * 3000 + 2500,
      viewToCartPct: 30, cartToCheckoutPct: 66.7, checkoutToPurchasePct: 75, viewToCheckoutPct: 20, viewToPurchasePct: 15,
      returnedUnits: 1, returnRatePct: 20,
    });
    // 5 sold against 5 sold + 6 in stock
    expect(body.totals.sellThroughPct).toBe(45.5);
  });

  it("compares with the previous period", async () => {
    const body = await json(await get(`/products/${tee}?range=today&tz=${TZ}`));
    expect(body.previous).toMatchObject({ views: 10, addToCarts: 0, checkouts: 0, purchases: 0 });
    expect(body.deltas.viewsPct).toBe(100);
    expect(body.deltas.purchasesPct).toBeNull();
  });

  it("returns 14 local days of revenue, today last", async () => {
    const body = await json(await get(`/products/${tee}?range=all&tz=${TZ}`));
    expect(body.revenueByDay).toHaveLength(14);
    expect(body.revenueByDay.at(-1)).toMatchObject({ revenueCents: 4 * 3000 + 2500, units: 5 });
    expect(body.revenueByDay.slice(0, -1).every((d: any) => d.revenueCents === 0)).toBe(true);
  });

  it("names the best variant, size and colour from real order lines", async () => {
    const body = await json(await get(`/products/${tee}?range=all&tz=${TZ}`));
    expect(body.bestVariantId).toBe(v.m);
    expect(body.bestSize).toEqual({ value: "M", units: 3 });
    expect(body.bestColor).toEqual({ value: "Black", units: 4 });
  });

  it("is honestly empty for a product with no activity", async () => {
    const [p] = await db.insert(products).values({ ownerId: A, name: "Fresh" }).returning();
    const body = await json(await get(`/products/${p.id}?range=week&tz=${TZ}`));
    expect(body.totals).toMatchObject({
      views: 0, addToCarts: 0, checkouts: 0, purchases: 0, units: 0, revenueCents: 0,
      viewToCartPct: null, cartToCheckoutPct: null, checkoutToPurchasePct: null, viewToPurchasePct: null, returnRatePct: null, sellThroughPct: null,
    });
    expect(body.bestVariantId).toBeNull();
    expect(body.bestSize).toBeNull();
    expect(body.bestColor).toBeNull();
    expect(body.revenueByDay.every((d: any) => d.revenueCents === 0)).toBe(true);
  });

  it("does not shadow GET /products", async () => {
    const body = await json(await get(`/products?range=today&tz=${TZ}`));
    expect(Array.isArray(body.products)).toBe(true);
  });
});
