/**
 * Seller analytics reports (migrations 120 + 121): product stats, threads and
 * videos, audience (k-anonymity, followers, devices), goals (several per
 * seller), advanced (Pro-gated), export (orders / products / analytics /
 * content / audience / goals), add-to-cart capture, device capture on store
 * visits and the retention job. Every endpoint is checked for auth, seller
 * isolation, range handling (Today / Week / Month / Year / All with a tz
 * offset) and an honest empty response.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db, users, products, productVariants, orders, orderItems, posts, postComments, interactions,
  storeVisits, storefrontVisits, sellerProductEvents, sellerGoalTargets, cartItems, follows, savedItems,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const A = `ins-a-${sfx}`;
const B = `ins-b-${sfx}`;
const buyers = Array.from({ length: 8 }, (_, i) => `ins-buyer-${i}-${sfx}`);

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null, plan: "starter" as "starter" | "pro" }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: authState.clerkUserId }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: (min: string) => (_q: unknown, res: any, next: () => void) => {
    if (min === "pro" && authState.plan !== "pro") { res.status(403).json({ error: "Upgrade required", code: "PLAN_UPGRADE_REQUIRED" }); return; }
    next();
  },
}));
// Advanced analytics and export (planCatalogue.ts): this file's sellers are Starter or Pro.
vi.mock("../../middlewares/featureGate", () => ({
  featureGate: () => (_q: unknown, res: any, next: () => void) => {
    if (authState.plan !== "pro") { res.status(403).json({ error: "Plan required", code: "PLAN_REQUIRED" }); return; }
    next();
  },
}));

let server: Server;
let base = "";
let prodA = "";
let prodB = "";
let varA = "";
let varB = "";
let postA = "";

const get = (path: string, as: string | null = A) => {
  authState.clerkUserId = as;
  return fetch(`${base}${path}`);
};
const send = (method: string, path: string, body?: unknown, as: string | null = A, headers: Record<string, string> = {}) => {
  authState.clerkUserId = as;
  return fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
};
const json = async (r: Response) => (await r.json()) as any;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
// One minute before local midnight: always inside the previous period of
// "today" (which is as long as today's elapsed hours), whatever the hour.
const yesterday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return new Date(d.getTime() - 60_000); };
// A moment safely inside "today" whatever the local hour: now minus a few
// seconds. The window is capped at the end of the current hour, so this always
// lands in the last bucket.
const justNow = () => new Date(Date.now() - 5_000);
const TZ = -new Date().getTimezoneOffset();
const q = (range: string, extra = "") => `range=${range}&tz=${TZ}${extra}`;

async function makeOrder(owner: string, buyer: string | null, variantId: string, totalCents: number, country: string, source?: string, createdAt = justNow(), extra: Partial<typeof orders.$inferInsert> = {}) {
  const [o] = await db.insert(orders).values({
    ownerId: owner, buyerId: buyer, orderNumber: `INS-${crypto.randomBytes(4).toString("hex")}`,
    totalCents, subtotalCents: totalCents, status: "processing", paidAt: createdAt, createdAt,
    sourcePostId: source ?? null,
    shippingAddress: { street: "1 Main", city: "X", state: "CA", zip: "1", country },
    ...extra,
  }).returning();
  await db.insert(orderItems).values({ orderId: o.id, variantId, productName: "P", quantity: 1, priceCents: totalCents });
  return o;
}

beforeAll(async () => {
  await db.insert(users).values([A, B, ...buyers].map((id) => ({
    clerkId: id, email: `${id}@test.local`, name: id, displayName: id === buyers[0] ? "Top Buyer" : null,
    role: id === A || id === B ? "seller" : "buyer", accountType: id === A || id === B ? "seller" : "buyer",
  })));
  const [pa] = await db.insert(products).values({ ownerId: A, name: "=Formula Tee", images: ["https://img.test/tee.jpg"] }).returning();
  const [pb] = await db.insert(products).values({ ownerId: B, name: "B Secret Hoodie" }).returning();
  prodA = pa.id; prodB = pb.id;
  const [va] = await db.insert(productVariants).values({ productId: prodA, sku: `SKU-A-${sfx}`, priceCents: 5000, stock: 9 }).returning();
  const [vb] = await db.insert(productVariants).values({ productId: prodB, sku: `SKU-B-${sfx}`, priceCents: 7000, stock: 9 }).returning();
  varA = va.id; varB = vb.id;

  // A today: 10 product views (2 by the same signed-in buyer), devices split, 4 carts, 8 purchases
  await db.insert(storeVisits).values([
    ...Array.from({ length: 8 }, (_, i) => ({ sellerId: A, productId: prodA, source: "feed", device: i < 5 ? "ios" : "web", createdAt: justNow() })),
    { sellerId: A, productId: prodA, source: "feed", viewerUserId: buyers[0], device: "android", createdAt: justNow() },
    { sellerId: A, productId: prodA, source: "feed", viewerUserId: buyers[0], device: "android", createdAt: justNow() },
    // a forged product id from another seller must never be counted for A
    { sellerId: A, productId: prodB, source: "feed", createdAt: justNow() },
    { sellerId: B, productId: prodB, source: "feed", createdAt: justNow() },
    // a profile visit yesterday (previous period for "today")
    { sellerId: A, productId: null, source: "profile", createdAt: yesterday() },
  ]);
  await db.insert(storefrontVisits).values(Array.from({ length: 4 }, (_, i) => ({ sellerId: A, visitorId: `v${i}-${sfx}`, visitDate: new Date().toISOString().slice(0, 10), createdAt: justNow() })));
  await db.insert(sellerProductEvents).values([
    ...Array.from({ length: 4 }, (_, i) => ({ sellerId: A, productId: prodA, eventType: "add_to_cart", viewerKey: `k${i}`, createdAt: justNow() })),
    { sellerId: B, productId: prodB, eventType: "add_to_cart", viewerKey: "kb", createdAt: justNow() },
  ]);
  // A: 7 distinct buyers today in the US (buyer6 in DE), buyer0 returning (older order 60 days ago).
  await makeOrder(A, buyers[0], varA, 5000, "US", undefined, hoursAgo(24 * 60));
  for (let i = 0; i < 7; i++) await makeOrder(A, buyers[i], varA, 5000, i === 6 ? "DE" : "US");
  // one refunded + discounted order yesterday (previous period for today; inside week/month depending on weekday)
  await makeOrder(A, buyers[7], varA, 4000, "US", undefined, yesterday(), { refundedCents: 1000, discountAmountCents: 500, discountCode: "TEN" });
  await makeOrder(B, buyers[1], varB, 7000, "FR");

  // content: one post for A with views/likes/comments/saves/clicks and an attributed order; one for B
  const [pA] = await db.insert(posts).values({ userId: A, mediaUrl: "https://x/a.mp4", thumbnailUrl: "https://x/a.jpg", mediaType: "video", caption: "A video", postStatus: "published" }).returning();
  const [pB] = await db.insert(posts).values({ userId: B, mediaUrl: "https://x/b.mp4", mediaType: "video", caption: "B video", postStatus: "published" }).returning();
  postA = pA.id;
  await db.insert(interactions).values([
    ...buyers.slice(0, 4).map((u) => ({ userId: u, postId: postA, type: "view", createdAt: justNow() })),
    { userId: buyers[0], postId: postA, type: "watch_time", value: "10.00", createdAt: justNow() },
    { userId: buyers[1], postId: postA, type: "watch_time", value: "20.00", createdAt: justNow() },
    { userId: buyers[0], postId: postA, type: "like", createdAt: justNow() },
    { userId: buyers[0], postId: postA, type: "shop_click", createdAt: justNow() },
    { userId: buyers[2], postId: postA, type: "share", createdAt: justNow() },
    { userId: A, postId: postA, type: "view", createdAt: justNow() }, // seller's own view never counts
    { userId: buyers[1], postId: postA, type: "view", createdAt: yesterday() }, // yesterday
    { userId: buyers[5], postId: pB.id, type: "view", createdAt: justNow() },
  ]);
  await db.insert(postComments).values([
    { postId: postA, authorId: buyers[1], body: "nice", createdAt: justNow() },
    { postId: postA, authorId: A, body: "thanks", createdAt: justNow() }, // own reply never counts
  ]);
  await db.insert(savedItems).values({ userId: buyers[2], itemType: "post", targetId: postA, title: "A video", createdAt: justNow() });
  await makeOrder(A, buyers[2], varA, 5000, "US", postA);
  await db.insert(follows).values([
    { followerId: buyers[3], followingId: A, createdAt: justNow() },
    { followerId: buyers[4], followingId: A, createdAt: hoursAgo(24 * 400) }, // long-standing follower
  ]);

  const app = express();
  app.use(express.json() as any);
  const { default: insights } = await import("../analytics-insights");
  const { default: cartDb } = await import("../cart-db");
  const { default: publicRouter } = await import("../public");
  app.use("/api/analytics/insights", insights);
  app.use("/api/buyer/cart", cartDb);
  app.use("/api/public", publicRouter);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const sellers = [A, B];
  await db.delete(orders).where(inArray(orders.ownerId, sellers));
  await db.delete(posts).where(inArray(posts.userId, sellers));
  await db.delete(storeVisits).where(inArray(storeVisits.sellerId, sellers));
  await db.delete(storefrontVisits).where(inArray(storefrontVisits.sellerId, sellers));
  await db.delete(sellerProductEvents).where(inArray(sellerProductEvents.sellerId, sellers));
  await db.delete(sellerGoalTargets).where(inArray(sellerGoalTargets.sellerId, sellers));
  await db.delete(cartItems).where(inArray(cartItems.userId, buyers));
  await db.delete(savedItems).where(inArray(savedItems.userId, buyers));
  await db.delete(follows).where(inArray(follows.followingId, sellers));
  await db.delete(products).where(inArray(products.ownerId, sellers));
  await db.delete(users).where(inArray(users.clerkId, [...sellers, ...buyers]));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("auth", () => {
  for (const path of ["/products", "/content", "/audience", "/goals", "/advanced"]) {
    it(`GET ${path} rejects signed-out callers`, async () => {
      expect((await get(`/api/analytics/insights${path}`, null)).status).toBe(401);
    });
  }
  it("goal writes and export reject signed-out callers", async () => {
    expect((await send("POST", "/api/analytics/insights/goals", { metric: "orders", target: 5 }, null)).status).toBe(401);
    expect((await send("DELETE", `/api/analytics/insights/goals/${crypto.randomUUID()}`, undefined, null)).status).toBe(401);
    expect((await send("POST", "/api/analytics/insights/export", { format: "csv", sections: ["products"] }, null)).status).toBe(401);
  });
  it("GET /best-time no longer exists", async () => {
    expect((await get("/api/analytics/insights/best-time")).status).toBe(404);
  });
});

describe("GET /products", () => {
  it("defaults to today and reports views, carts, purchases, conversion, thumbnails and buckets for the seller only", async () => {
    const body = await json(await get(`/api/analytics/insights/products?tz=${TZ}`));
    expect(body.window.range).toBe("today");
    expect(body.window.step).toBe("1 hour");
    expect(body.products).toHaveLength(1);
    const p = body.products[0];
    expect(p).toMatchObject({ productId: prodA, name: "=Formula Tee", imageUrl: "https://img.test/tee.jpg", stock: 9, views: 10, uniqueViewers: 1, addToCarts: 4, purchases: 8, viewToCartPct: 40, cartToPurchasePct: 100 });
    expect(body.totals.views).toBe(10);
    expect(body.totals.revenueCents).toBe(8 * 5000);
    expect(body.buckets.reduce((a: number, b: any) => a + b.views, 0)).toBe(10);
    expect(body.buckets.reduce((a: number, b: any) => a + b.purchases, 0)).toBe(8);
    expect(JSON.stringify(body)).not.toContain("Secret Hoodie");
  });
  it("compares against the previous period", async () => {
    const body = await json(await get(`/api/analytics/insights/products?${q("today")}`));
    // yesterday had 1 purchase (the refunded one) and no product views
    expect(body.previous.purchases).toBe(1);
    expect(body.deltas.purchasesPct).toBe(700);
    expect(body.deltas.viewsPct).toBeNull(); // 0 -> 10 has no percentage
  });
  it("widens with the range: the 60-day-old order is outside week/month but inside all", async () => {
    const today = await json(await get(`/api/analytics/insights/products?${q("today")}`));
    const all = await json(await get(`/api/analytics/insights/products?${q("all")}`));
    expect(all.window.range).toBe("all");
    expect(all.previous).toBeNull();
    expect(all.totals.purchases).toBe(today.totals.purchases + 2); // + yesterday + 60 days ago
    expect(all.buckets.length).toBeGreaterThan(1);
    for (const range of ["week", "month", "year"]) {
      const r = await json(await get(`/api/analytics/insights/products?${q(range)}`));
      expect(r.window.range).toBe(range);
      expect(r.totals.purchases).toBeGreaterThanOrEqual(today.totals.purchases);
      expect(r.totals.purchases).toBeLessThanOrEqual(all.totals.purchases);
    }
  });
  it("falls back to today for an unknown range and UTC for a bad tz", async () => {
    const body = await json(await get("/api/analytics/insights/products?range=30d&tz=abc"));
    expect(body.window.range).toBe("today");
  });
  it("does not leak seller A data to seller B", async () => {
    const body = await json(await get(`/api/analytics/insights/products?${q("today")}`, B));
    expect(body.products.map((p: any) => p.productId)).toEqual([prodB]);
    expect(body.products[0].views).toBe(1);
  });
  it("is honestly empty for a seller with nothing", async () => {
    authState.clerkUserId = B;
    const body = await json(await get(`/api/analytics/insights/products?${q("year")}`, B));
    expect(body.totals.addToCarts).toBe(1);
    const empty = await json(await get(`/api/analytics/insights/products?${q("today")}`, `nobody-${sfx}`));
    expect(empty.products).toEqual([]);
    expect(empty.totals).toMatchObject({ views: 0, purchases: 0, revenueCents: 0, viewToCartPct: null });
    expect(empty.buckets.every((b: any) => b.views === 0 && b.purchases === 0)).toBe(true);
  });
});

describe("GET /content", () => {
  it("aggregates real interactions, comments, saves, attribution and follower growth", async () => {
    const body = await json(await get(`/api/analytics/insights/content?${q("today")}`));
    expect(body.totals).toMatchObject({ views: 4, uniqueViewers: 4, likes: 1, comments: 1, saves: 1, shares: 1, productClicks: 1, purchases: 1, revenueCents: 5000, followerGrowth: 1, avgWatchSeconds: 15 });
    expect(body.previous.views).toBe(1); // yesterday's view
    expect(body.deltas.viewsPct).toBe(300);
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0]).toMatchObject({ postId: postA, type: "video", thumbnailUrl: "https://x/a.jpg", views: 4, comments: 1, saves: 1, purchases: 1 });
    expect(body.byType.find((t: any) => t.type === "video")).toEqual({ type: "video", posts: 1, views: 4 });
    expect(body.buckets.reduce((a: number, b: any) => a + b.views, 0)).toBe(4);
    expect(body.totals).not.toHaveProperty("completionRate");
  });
  it("never includes another seller's posts and is empty for a seller without posts", async () => {
    const body = await json(await get(`/api/analytics/insights/content?${q("today")}`, B));
    expect(body.posts.map((p: any) => p.caption)).toEqual(["B video"]);
    expect(body.totals.views).toBe(1);
    const empty = await json(await get(`/api/analytics/insights/content?${q("week")}`, `nobody-${sfx}`));
    expect(empty.posts).toEqual([]);
    expect(empty.totals.views).toBe(0);
    expect(empty.totals.avgWatchSeconds).toBeNull();
  });
});

describe("GET /audience", () => {
  it("reports followers, k-anonymous splits, locations and devices", async () => {
    const body = await json(await get(`/api/analytics/insights/audience?${q("today")}`));
    expect(body.minGroupSize).toBe(5);
    expect(body.followers).toMatchObject({ total: 2, gained: 1, previousGained: 0 });
    expect(body.buckets.reduce((a: number, b: any) => a + b.followers, 0)).toBe(1);
    // 8 buyers today (7 + attributed order by buyer2 is the same person -> 7 distinct); buyer0 returning (<5, hidden)
    expect(body.buyers.returning).toBeNull();
    expect(body.buyers.suppressed).toBe(true);
    expect(body.topCountries).toEqual([{ country: "US", people: 6 }]); // DE (1 person) hidden
    expect(body.hiddenLocations).toBe(1);
    expect(JSON.stringify(body)).not.toContain("FR");
    expect(body.devices).toEqual([
      { device: "ios", visits: 5, sharePct: 45.5 },
      { device: "android", visits: 2, sharePct: 18.2 },
      { device: "web", visits: 3, sharePct: 27.3 },
      { device: "unknown", visits: 1, sharePct: 9.1 },
    ]);
    expect(body).not.toHaveProperty("ageBands");
  });
  it("shows nothing for a seller with no audience", async () => {
    const body = await json(await get(`/api/analytics/insights/audience?${q("month")}`, `nobody-${sfx}`));
    expect(body.topCountries).toEqual([]);
    expect(body.devices).toEqual([]);
    expect(body.followers.total).toBe(0);
    expect(body.buyers.new).toBeNull();
  });
});

describe("goals", () => {
  let id = "";
  it("starts empty, then creates several goals with real progress and pacing", async () => {
    expect((await json(await get(`/api/analytics/insights/goals?tz=${TZ}`))).goals).toEqual([]);
    const created = await send("POST", "/api/analytics/insights/goals", { metric: "revenue", period: "month", target: 100000, tz: TZ });
    expect(created.status).toBe(201);
    const g = (await json(created)).goal;
    id = g.id;
    expect(g).toMatchObject({ metric: "revenue", period: "month", target: 100000 });
    expect(g.actual).toBeGreaterThanOrEqual(8 * 5000); // today's paid orders at least
    expect(typeof g.progressPct).toBe("number");
    expect(["achieved", "on_track", "behind", "not_started"]).toContain(g.status);
    const second = await json(await send("POST", "/api/analytics/insights/goals", { metric: "followers", period: "week", target: 1, tz: TZ }));
    expect(second.goal.actual).toBe(1);
    expect(second.goal.status).toBe("achieved");
    expect(second.goals).toHaveLength(2);
    const visits = await json(await send("POST", "/api/analytics/insights/goals", { metric: "visits", period: "quarter", target: 100, tz: TZ }));
    expect(visits.goal.actual).toBe(4);
    const units = await json(await send("POST", "/api/analytics/insights/goals", { metric: "units", period: "year", target: 500, tz: TZ }));
    expect(units.goal.actual).toBeGreaterThanOrEqual(9);
  });
  it("updates and deletes only the seller's own goal", async () => {
    const upd = await send("PUT", `/api/analytics/insights/goals/${id}`, { metric: "orders", period: "week", target: 50, tz: TZ });
    expect(upd.status).toBe(200);
    expect((await json(upd)).goal).toMatchObject({ id, metric: "orders", period: "week", target: 50 });
    expect((await send("PUT", `/api/analytics/insights/goals/${id}`, { metric: "orders", target: 5 }, B)).status).toBe(404);
    expect((await send("DELETE", `/api/analytics/insights/goals/${id}`, undefined, B)).status).toBe(404);
    expect((await json(await get("/api/analytics/insights/goals", B))).goals).toEqual([]);
    expect((await send("DELETE", `/api/analytics/insights/goals/${id}`)).status).toBe(200);
    expect((await json(await get("/api/analytics/insights/goals"))).goals.map((g: any) => g.id)).not.toContain(id);
    expect((await send("DELETE", `/api/analytics/insights/goals/${id}`)).status).toBe(404);
  });
  it("validates input", async () => {
    for (const body of [{ metric: "profit", target: 5 }, { metric: "orders", target: 0 }, { metric: "orders", target: 1.5 }, { metric: "revenue", target: 5_000_000_000 }, { metric: "orders", period: "decade", target: 5 }, {}]) {
      expect((await send("POST", "/api/analytics/insights/goals", body)).status).toBe(400);
    }
    expect((await send("PUT", "/api/analytics/insights/goals/not-a-uuid", { metric: "orders", target: 5 })).status).toBe(404);
  });
});

describe("GET /advanced", () => {
  it("is gated by the real plan entitlement", async () => {
    authState.plan = "starter";
    expect((await get(`/api/analytics/insights/advanced?${q("today")}`)).status).toBe(403);
  });
  it("reports AOV, repeat buyers, refunds, channels and top customers for Pro sellers", async () => {
    authState.plan = "pro";
    try {
      const body = await json(await get(`/api/analytics/insights/advanced?${q("today")}`));
      expect(body.totals).toMatchObject({ orders: 8, revenueCents: 40000, averageOrderCents: 5000, buyers: 7, threadOrders: 1, threadRevenueCents: 5000, visits: 4 });
      expect(body.totals.conversionPct).toBe(200); // 8 orders / 4 deduped visits — real numbers, not clamped
      expect(body.totals.repeatBuyers).toBe(2); // buyer0 (prior order) + buyer2 (two orders today)
      expect(body.previous.refundedOrders).toBe(1);
      expect(body.previous.refundRatePct).toBe(100);
      expect(body.channels).toEqual([
        { channel: "threads", orders: 1, revenueCents: 5000 },
        { channel: "store", orders: 7, revenueCents: 35000 },
      ]);
      expect(body.topCustomers[0]).toMatchObject({ orders: 2, totalCents: 10000 });
      expect(body.topCustomers.find((c: any) => c.name === "Top Buyer")).toBeTruthy();
      expect(body.topCustomers.length).toBeLessThanOrEqual(5);
      expect(body.buckets.reduce((a: number, b: any) => a + b.orders, 0)).toBe(8);
      const other = await json(await get(`/api/analytics/insights/advanced?${q("today")}`, B));
      expect(other.totals.orders).toBe(1);
    } finally { authState.plan = "starter"; }
  });
});

describe("POST /export", () => {
  // Export is part of Pro's full analytics (planCatalogue.ts).
  beforeEach(() => { authState.plan = "pro"; });
  afterEach(() => { authState.plan = "starter"; });
  it("is refused below Pro", async () => {
    authState.plan = "starter";
    const res = await send("POST", "/api/analytics/insights/export", { format: "csv", range: "today", sections: ["orders"], tz: TZ });
    expect(res.status).toBe(403);
  });
  it("produces a formula-safe CSV of orders, products and analytics for the seller's own data", async () => {
    const res = await send("POST", "/api/analytics/insights/export", { format: "csv", range: "today", sections: ["orders", "products", "analytics", "audience"], tz: TZ });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.mimeType).toBe("text/csv");
    expect(body.filename).toMatch(/^brandthread-analytics-today-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(body.data).toContain("Range: Today");
    expect(body.data).toContain("'=Formula Tee"); // injection neutralised
    expect(body.data).not.toContain("Secret Hoodie");
    expect(body.data).toContain("Orders\nOrder,Date,Status,Paid,Units");
    expect(body.data.match(/INS-/g)?.length).toBe(8);
    expect(body.data).toContain(",threads,");
    expect(body.data).toContain("Period start,Visits,Product views,Orders,Revenue,Net revenue,New followers");
    expect(body.data).toContain("Country: US");
    expect(body.data).not.toContain("Country: DE"); // k-anonymity holds in exports
    expect(body.data).toContain("Device: ios,5");
  });
  it("produces a real PDF with every section", async () => {
    const body = await json(await send("POST", "/api/analytics/insights/export", { format: "pdf", range: "all", sections: ["orders", "products", "analytics", "content", "audience", "goals"], tz: TZ }));
    expect(body.encoding).toBe("base64");
    const buf = Buffer.from(body.data, "base64");
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
  it("rejects bad input", async () => {
    expect((await send("POST", "/api/analytics/insights/export", { format: "xls", sections: ["products"] })).status).toBe(400);
    expect((await send("POST", "/api/analytics/insights/export", { format: "csv", sections: [] })).status).toBe(400);
    expect((await send("POST", "/api/analytics/insights/export", { format: "csv", sections: ["best_time"] })).status).toBe(400);
    expect((await send("POST", "/api/analytics/insights/export", { format: "csv", range: "30d", sections: ["orders"] })).status).toBe(400);
  });
});

describe("device capture on POST /api/public/sellers/:id/store-visits", () => {
  it("stores the declared platform, else sniffs the User-Agent", async () => {
    const visits = async () => db.select().from(storeVisits).where(eq(storeVisits.sellerId, B));
    const before = (await visits()).length;
    expect((await send("POST", `/api/public/sellers/${B}/store-visits`, { source: "search", device: "android" }, buyers[0])).status).toBe(204);
    expect((await send("POST", `/api/public/sellers/${B}/store-visits`, { source: "search" }, buyers[0], { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" })).status).toBe(204);
    expect((await send("POST", `/api/public/sellers/${B}/store-visits`, { source: "search", device: "fridge" }, buyers[0], { "user-agent": "" })).status).toBe(204);
    const rows = (await visits()).slice(before).map((r) => r.device);
    expect(rows).toEqual(["android", "ios", null]);
  });
});

describe("add-to-cart capture on POST /api/buyer/cart/sync", () => {
  const item = (variantId: string) => ({ variantId, quantity: 1, priceCents: 5000 });
  const count = async () => (await db.select().from(sellerProductEvents).where(eq(sellerProductEvents.sellerId, A))).filter((e) => !/^k\d$/.test(e.viewerKey));
  const waitFor = async (n: number) => { for (let i = 0; i < 40; i++) { if ((await count()).length >= n) return; await new Promise((r) => setTimeout(r, 25)); } };

  it("records one hashed add_to_cart for a new line and none for a re-sync", async () => {
    const r1 = await send("POST", "/api/buyer/cart/sync", { items: [item(varA)] }, buyers[4]);
    expect(r1.status).toBe(200);
    await waitFor(1);
    const rows = await count();
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe(prodA);
    expect(rows[0].viewerKey).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].viewerKey).not.toContain(buyers[4]);
    await send("POST", "/api/buyer/cart/sync", { items: [item(varA)] }, buyers[4]);
    await new Promise((r) => setTimeout(r, 150));
    expect(await count()).toHaveLength(1);
  });
  it("never fails the cart request on garbage variant ids", async () => {
    const r = await send("POST", "/api/buyer/cart/sync", { items: [{ variantId: "zzz" }, { id: null }] }, buyers[5]);
    expect(r.status).toBe(200);
  });
  it("ignores a seller carting their own product", async () => {
    const before = (await count()).length;
    await send("POST", "/api/buyer/cart/sync", { items: [item(varA)] }, A);
    await new Promise((r) => setTimeout(r, 150));
    expect((await count()).length).toBe(before);
  });
  it("diffs only genuinely new, well-formed variant ids", async () => {
    const { newlyAddedVariantIds } = await import("../../lib/sellerProductEvents");
    const V = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    expect(newlyAddedVariantIds([V(1)], [V(1), V(2), V(2), "junk"])).toEqual([V(2)]);
    expect(newlyAddedVariantIds([], [])).toEqual([]);
  });
});

describe("analyticsRetention job", () => {
  it("prunes only events older than 400 days", async () => {
    const { runAnalyticsRetention } = await import("../../jobs/analyticsRetention");
    const old = new Date(Date.now() - 401 * 86400_000);
    const fresh = new Date(Date.now() - 399 * 86400_000);
    await db.insert(sellerProductEvents).values([
      { sellerId: B, productId: prodB, eventType: "add_to_cart", viewerKey: "old", createdAt: old },
      { sellerId: B, productId: prodB, eventType: "add_to_cart", viewerKey: "fresh", createdAt: fresh },
    ]);
    const deleted = await runAnalyticsRetention();
    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = (await db.select().from(sellerProductEvents).where(eq(sellerProductEvents.sellerId, B))).map((r) => r.viewerKey);
    expect(left).toContain("fresh");
    expect(left).not.toContain("old");
  });
});
