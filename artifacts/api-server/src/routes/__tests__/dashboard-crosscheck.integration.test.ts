/**
 * Seller dashboard cross-check: every number the Home dashboard shows comes
 * from these endpoints, and each must equal what the tables say.
 *
 * Seeds one seller (products + variants, paid / unpaid / cancelled orders
 * today, yesterday and earlier in the month, shipped to cities around the
 * world, storefront + store visits, return requests), calls the real routes
 * the dashboard calls, and checks each figure against an independent SQL
 * query on orders / order_items / returns / visits.
 *
 * With DASHBOARD_CROSSCHECK_OUT set it also writes the real responses to that
 * file, so the web harness can serve them to the dashboard and compare what
 * the screen renders (artifacts/mobile/docs/qa/dashboard-globe/).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db, orderItems, orders, products, productVariants, returns, storeVisits, storefrontVisits, users } from "@workspace/db";

const suffix = crypto.randomBytes(5).toString("hex");
const SELLER = `xcheck-seller-${suffix}`;
const BUYER = `xcheck-buyer-${suffix}`;
// Fixed seller timezone so "today" is unambiguous: UTC.
const TZ = 0;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = SELLER; next(); },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
  getAuth: () => ({ userId: SELLER }),
}));
vi.mock("../../middlewares/requireRole", async (orig) => ({
  ...(await orig<any>()),
  teamContext: () => (req: any, _res: any, next: () => void) => {
    req.teamContext = { actorClerkId: SELLER, storeOwnerId: SELLER, role: "owner" };
    req.clerkUserId = SELLER;
    next();
  },
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

let server: Server;
let base = "";
const DAY = 86_400_000;
const now = new Date();
const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const out: Record<string, unknown> = {};

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  expect(res.status, path).toBe(200);
  const body = await res.json();
  out[path.split("?")[0] + (path.includes("range=") ? `?range=${/range=(\w+)/.exec(path)![1]}` : "")] = body;
  return body as any;
}

const at = (msAgo: number) => new Date(now.getTime() - msAgo);
const CITIES: Array<[string, string, string]> = [
  ["Tokyo", "", "JP"], ["Paris", "", "FR"], ["Sydney", "NSW", "AU"], ["São Paulo", "SP", "BR"],
  ["Berlin", "", "DE"], ["Toronto", "ON", "CA"], ["Austin", "TX", "US"], ["London", "", "GB"],
];

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@test.local`, name: "Northline", displayName: "Northline Studio", accountType: "seller", onboardingComplete: true },
    { clerkId: BUYER, email: `${BUYER}@test.local`, name: "Buyer", displayName: "Ana Buyer", accountType: "buyer", onboardingComplete: true },
  ]);
  const [coat, gown, scarf] = await db.insert(products).values([
    { ownerId: SELLER, name: "Wool Overcoat", status: "active", images: ["https://img.test/coat.jpg"] },
    { ownerId: SELLER, name: "Silver Gown", status: "active", images: ["https://img.test/gown.jpg"] },
    { ownerId: SELLER, name: "Silk Scarf", status: "active", images: [] },
  ] as any).returning({ id: products.id });
  const [vCoat, vGown, vScarf] = await db.insert(productVariants).values([
    { productId: coat.id, sku: `XC-COAT-${suffix}`, priceCents: 24000, stock: 3, lowStockThreshold: 5 },
    { productId: gown.id, sku: `XC-GOWN-${suffix}`, priceCents: 7800, stock: 40, lowStockThreshold: 5 },
    { productId: scarf.id, sku: `XC-SCARF-${suffix}`, priceCents: 1500, stock: 0, lowStockThreshold: 5 },
  ] as any).returning({ id: productVariants.id });

  // [msAgo, status, paid, lines, city]
  const seeds: Array<[number, string, boolean, Array<[string, string, number, number]>, number]> = [
    [5 * 60_000, "pending", true, [[vCoat.id, "Wool Overcoat", 1, 24000]], 0],
    [40 * 60_000, "pending", true, [[vGown.id, "Silver Gown", 2, 7800], [vScarf.id, "Silk Scarf", 1, 1500]], 1],
    [70 * 60_000, "processing", true, [[vScarf.id, "Silk Scarf", 3, 1500]], 2],
    [80 * 60_000, "cancelled", false, [[vCoat.id, "Wool Overcoat", 1, 24000]], 3],
    [90 * 60_000, "pending", false, [[vGown.id, "Silver Gown", 1, 7800]], 4],
    [DAY + 20 * 60_000, "shipped", true, [[vGown.id, "Silver Gown", 1, 7800]], 5],
    [3 * DAY, "delivered", true, [[vCoat.id, "Wool Overcoat", 1, 24000]], 6],
    [9 * DAY, "delivered", true, [[vScarf.id, "Silk Scarf", 2, 1500]], 7],
  ];
  let n = 0;
  for (const [ago, status, paid, lines, city] of seeds) {
    n += 1;
    const total = lines.reduce((s, l) => s + l[2] * l[3], 0) + 600;
    const created = at(ago);
    const [row] = await db.insert(orders).values({
      ownerId: SELLER, buyerId: BUYER, orderNumber: `#XC${1000 + n}`, status, totalCents: total, subtotalCents: total - 600,
      shippingCents: 600, paidAt: paid ? created : null, createdAt: created,
      shippingAddress: { name: "Ana Buyer", street: "1 Test St", city: CITIES[city][0], state: CITIES[city][1], zip: "00000", country: CITIES[city][2] },
    }).returning({ id: orders.id });
    await db.insert(orderItems).values(lines.map(([variantId, productName, quantity, priceCents]) => ({ orderId: row.id, variantId, productName, quantity, priceCents })));
    if (n === 6) await db.insert(returns).values({ id: `ret_${suffix}_1`, orderId: row.id, buyerId: BUYER, sellerId: SELLER, reason: "fit", status: "pending" });
    if (n === 7) await db.insert(returns).values({ id: `ret_${suffix}_2`, orderId: row.id, buyerId: BUYER, sellerId: SELLER, reason: "fit", status: "approved" });
  }
  // Visits land inside today whatever time the suite runs.
  const visitAt = new Date(todayStart + Math.floor((now.getTime() - todayStart) / 2));
  const today = new Date(todayStart).toISOString().slice(0, 10);
  const yesterday = new Date(todayStart - DAY).toISOString().slice(0, 10);
  await db.insert(storefrontVisits).values([
    ...Array.from({ length: 12 }, (_, i) => ({ sellerId: SELLER, visitorId: `v${i}`, visitDate: today, createdAt: visitAt })),
    ...Array.from({ length: 4 }, (_, i) => ({ sellerId: SELLER, visitorId: `y${i}`, visitDate: yesterday, createdAt: new Date(todayStart - DAY + 60_000) })),
  ] as any);
  await db.insert(storeVisits).values([
    ...Array.from({ length: 6 }, () => ({ sellerId: SELLER, source: "feed", createdAt: visitAt })),
    ...Array.from({ length: 3 }, () => ({ sellerId: SELLER, source: "search", createdAt: visitAt })),
    ...Array.from({ length: 3 }, () => ({ sellerId: SELLER, source: "external", createdAt: visitAt })),
  ] as any);

  const app = express();
  app.use(express.json());
  app.use("/api/analytics", (await import("../analytics")).default);
  app.use("/api/orders", (await import("../orders")).default);
  app.use("/api/returns", (await import("../returns")).default);
  app.use("/api/products", (await import("../products")).default);
  app.use("/api/seller/live-map", (await import("../seller-live-map")).default);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (process.env.DASHBOARD_CROSSCHECK_OUT) fs.writeFileSync(process.env.DASHBOARD_CROSSCHECK_OUT, JSON.stringify(out, null, 2));
  await db.delete(returns).where(inArray(returns.sellerId, [SELLER]));
  await db.delete(orders).where(inArray(orders.ownerId, [SELLER]));
  await db.delete(products).where(inArray(products.ownerId, [SELLER]));
  await db.delete(storefrontVisits).where(inArray(storefrontVisits.sellerId, [SELLER]));
  await db.delete(storeVisits).where(inArray(storeVisits.sellerId, [SELLER]));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, BUYER]));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/** Ground truth: paid, non-cancelled orders created in [from, to). */
async function truth(from: number, to: number) {
  const r = await db.execute(sql`
    SELECT coalesce(sum(total_cents), 0)::int AS total, count(*)::int AS n FROM orders
     WHERE owner_id = ${SELLER} AND paid_at IS NOT NULL AND status <> 'cancelled'
       AND created_at >= ${new Date(from).toISOString()}::timestamptz AT TIME ZONE 'UTC'
       AND created_at <  ${new Date(to).toISOString()}::timestamptz AT TIME ZONE 'UTC'`);
  const row = (r as any).rows[0];
  return { totalCents: Number(row.total), orderCount: Number(row.n) };
}

describe("dashboard numbers equal the tables", () => {
  it("hero, Orders tile, AOV, conversion and the vs-yesterday change (Today)", async () => {
    const home = await get(`/api/analytics/home?range=today&tz=${TZ}`);
    const hourEnd = Math.min(todayStart + DAY, Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
    const t = await truth(todayStart, hourEnd);
    const y = await truth(todayStart - DAY, todayStart - DAY + (hourEnd - todayStart));
    expect(home.totalCents).toBe(t.totalCents);
    expect(home.orderCount).toBe(t.orderCount);
    expect(home.previous.totalCents).toBe(y.totalCents);
    expect(home.previous.orderCount).toBe(y.orderCount);
    expect(home.visitorCount).toBe(12);
    expect(home.averageOrderCents).toBe(t.orderCount ? Math.round(t.totalCents / t.orderCount) : 0);
    expect(home.conversionRate).toBe(Math.round((t.orderCount / 12) * 1000) / 10);
    expect(home.buckets.reduce((s: number, b: any) => s + b.totalCents, 0)).toBe(t.totalCents);
    // Traffic sources: real shares, scaled to the visitor headline.
    expect(home.trafficSources.reduce((s: number, x: any) => s + x.count, 0)).toBe(12);
    expect(home.trafficSources.find((x: any) => x.source === "feed").count).toBe(6);
  });

  it("7D / 30D windows", async () => {
    for (const [range, days] of [["7d", 7], ["30d", 30]] as const) {
      const home = await get(`/api/analytics/home?range=${range}&tz=${TZ}`);
      const t = await truth(todayStart - (days - 1) * DAY, todayStart + DAY);
      const p = await truth(todayStart - (2 * days - 1) * DAY, todayStart - (days - 1) * DAY);
      expect(home.totalCents).toBe(t.totalCents);
      expect(home.orderCount).toBe(t.orderCount);
      expect(home.previous.totalCents).toBe(p.totalCents);
    }
  });

  it("Top products: line revenue of paid, non-cancelled orders", async () => {
    const top = await get("/api/analytics/products");
    const r = await db.execute(sql`
      SELECT oi.product_name AS name, sum(oi.quantity * oi.price_cents)::int AS revenue, sum(oi.quantity)::int AS units
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.owner_id = ${SELLER} AND o.paid_at IS NOT NULL AND o.status <> 'cancelled'
       GROUP BY oi.product_name ORDER BY revenue DESC`);
    const expected = (r as any).rows.map((x: any) => [x.name, Number(x.revenue), Number(x.units)]);
    expect(top.filter((p: any) => p.revenueCents > 0).map((p: any) => [p.name, p.revenueCents, p.unitsSold])).toEqual(expected);
  });

  it("Recent orders, orders to ship and returns to review", async () => {
    const list = await get("/api/orders");
    const r = await db.execute(sql`SELECT order_number FROM orders WHERE owner_id = ${SELLER} ORDER BY created_at DESC LIMIT 5`);
    expect(list.slice(0, 5).map((o: any) => o.orderNumber)).toEqual((r as any).rows.map((x: any) => x.order_number));
    const rets = await get("/api/returns");
    const pending = await db.execute(sql`SELECT count(*)::int AS n FROM returns WHERE seller_id = ${SELLER} AND status = 'pending'`);
    expect(rets.filter((x: any) => x.status === "pending").length).toBe(Number((pending as any).rows[0].n));
    await get("/api/products");
  });

  it("Live count and the globe's recent orders", async () => {
    const live = await get(`/api/seller/live-map/today?tz=${TZ}`);
    const today = await truth(todayStart, now.getTime() + 1);
    expect(live.total).toBe(today.orderCount);
    const r = await db.execute(sql`
      SELECT order_number FROM orders WHERE owner_id = ${SELLER} AND paid_at IS NOT NULL AND status <> 'cancelled'
         AND paid_at >= ${new Date(now.getTime() - 7 * DAY).toISOString()}::timestamptz AT TIME ZONE 'UTC'
       ORDER BY paid_at DESC`);
    expect(live.recent.map((o: any) => o.orderNumber)).toEqual((r as any).rows.map((x: any) => x.order_number));
    expect(live.recent[0]).toMatchObject({ city: "Tokyo", country: "JP", item: "Wool Overcoat" });
  });
});
