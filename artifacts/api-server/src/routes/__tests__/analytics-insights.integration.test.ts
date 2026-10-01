/**
 * Seller analytics insights (migration 120): product funnel, content stats,
 * audience (k-anonymity), best time, goals, export, add-to-cart capture and
 * the retention job. Every endpoint is checked for auth and seller isolation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db, users, products, productVariants, orders, orderItems, posts, interactions,
  storeVisits, sellerProductEvents, sellerGoals, cartItems, follows,
} from "@workspace/db";
import { eq, inArray, like, or } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const A = `ins-a-${sfx}`;
const B = `ins-b-${sfx}`;
const buyers = Array.from({ length: 7 }, (_, i) => `ins-buyer-${i}-${sfx}`);

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
let prodA = "";
let prodB = "";
let varA = "";
let varB = "";
let postA = "";

const get = (path: string, as: string | null = A) => {
  authState.clerkUserId = as;
  return fetch(`${base}${path}`);
};
const send = (method: string, path: string, body?: unknown, as: string | null = A) => {
  authState.clerkUserId = as;
  return fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function makeOrder(owner: string, buyer: string | null, variantId: string, totalCents: number, country: string, source?: string, createdAt = hoursAgo(2)) {
  const [o] = await db.insert(orders).values({
    ownerId: owner, buyerId: buyer, orderNumber: `INS-${crypto.randomBytes(4).toString("hex")}`,
    totalCents, subtotalCents: totalCents, status: "processing", paidAt: createdAt, createdAt,
    sourcePostId: source ?? null,
    shippingAddress: { street: "1 Main", city: "X", state: "CA", zip: "1", country },
  }).returning();
  await db.insert(orderItems).values({ orderId: o.id, variantId, productName: "P", quantity: 1, priceCents: totalCents });
  return o;
}

beforeAll(async () => {
  await db.insert(users).values([A, B, ...buyers].map((id) => ({
    clerkId: id, email: `${id}@test.local`, name: id, role: id === A || id === B ? "seller" : "buyer",
    accountType: id === A || id === B ? "seller" : "buyer",
  })));
  const [pa] = await db.insert(products).values({ ownerId: A, name: "=Formula Tee" }).returning();
  const [pb] = await db.insert(products).values({ ownerId: B, name: "B Secret Hoodie" }).returning();
  prodA = pa.id; prodB = pb.id;
  const [va] = await db.insert(productVariants).values({ productId: prodA, sku: `SKU-A-${sfx}`, priceCents: 5000, stock: 9 }).returning();
  const [vb] = await db.insert(productVariants).values({ productId: prodB, sku: `SKU-B-${sfx}`, priceCents: 7000, stock: 9 }).returning();
  varA = va.id; varB = vb.id;

  // A: 10 product views (2 by the same signed-in buyer), 4 carts, 2 purchases
  await db.insert(storeVisits).values([
    ...Array.from({ length: 8 }, () => ({ sellerId: A, productId: prodA, source: "feed" })),
    { sellerId: A, productId: prodA, source: "feed", viewerUserId: buyers[0] },
    { sellerId: A, productId: prodA, source: "feed", viewerUserId: buyers[0] },
    // a forged product id from another seller must never be counted for A
    { sellerId: A, productId: prodB, source: "feed" },
    { sellerId: B, productId: prodB, source: "feed" },
  ]);
  await db.insert(sellerProductEvents).values([
    ...Array.from({ length: 4 }, (_, i) => ({ sellerId: A, productId: prodA, eventType: "add_to_cart", viewerKey: `k${i}` })),
    { sellerId: B, productId: prodB, eventType: "add_to_cart", viewerKey: "kb" },
  ]);
  // A: 7 distinct buyers in the US, 1 in DE, 6 of 7 US are new; buyer0 is returning
  await makeOrder(A, buyers[0], varA, 5000, "US", undefined, hoursAgo(24 * 60)); // prior to 30d window
  for (let i = 0; i < 7; i++) await makeOrder(A, buyers[i], varA, 5000, i === 6 ? "DE" : "US");
  await makeOrder(B, buyers[1], varB, 7000, "FR");

  // content: one post for A with views/clicks/order attribution, one for B
  const [pA] = await db.insert(posts).values({ userId: A, mediaUrl: "https://x/a.mp4", mediaType: "video", caption: "A video", postStatus: "published" }).returning();
  const [pB] = await db.insert(posts).values({ userId: B, mediaUrl: "https://x/b.mp4", mediaType: "video", caption: "B video", postStatus: "published" }).returning();
  postA = pA.id;
  await db.insert(interactions).values([
    ...buyers.slice(0, 4).map((u) => ({ userId: u, postId: postA, type: "view" })),
    { userId: buyers[0], postId: postA, type: "watch_time", value: "10.00" },
    { userId: buyers[1], postId: postA, type: "watch_time", value: "20.00" },
    { userId: buyers[0], postId: postA, type: "like" },
    { userId: buyers[0], postId: postA, type: "shop_click" },
    { userId: A, postId: postA, type: "view" }, // seller's own view never counts
    { userId: buyers[5], postId: pB.id, type: "view" },
  ]);
  await makeOrder(A, buyers[2], varA, 5000, "US", postA);
  await db.insert(follows).values({ followerId: buyers[3], followingId: A });

  const app = express();
  app.use(express.json() as any);
  const { default: insights } = await import("../analytics-insights");
  const { default: cartDb } = await import("../cart-db");
  app.use("/api/analytics/insights", insights);
  app.use("/api/buyer/cart", cartDb);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const sellers = [A, B];
  await db.delete(orders).where(inArray(orders.ownerId, sellers));
  await db.delete(posts).where(inArray(posts.userId, sellers));
  await db.delete(storeVisits).where(inArray(storeVisits.sellerId, sellers));
  await db.delete(sellerProductEvents).where(inArray(sellerProductEvents.sellerId, sellers));
  await db.delete(sellerGoals).where(inArray(sellerGoals.sellerId, sellers));
  await db.delete(cartItems).where(inArray(cartItems.userId, buyers));
  await db.delete(follows).where(inArray(follows.followingId, sellers));
  await db.delete(products).where(inArray(products.ownerId, sellers));
  await db.delete(users).where(inArray(users.clerkId, [...sellers, ...buyers]));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("auth", () => {
  for (const path of ["/products", "/content", "/audience", "/best-time", "/goals"]) {
    it(`GET ${path} rejects signed-out callers`, async () => {
      expect((await get(`/api/analytics/insights${path}`, null)).status).toBe(401);
    });
  }
  it("PUT/DELETE goals and export reject signed-out callers", async () => {
    expect((await send("PUT", "/api/analytics/insights/goals", { metric: "orders", target: 5 }, null)).status).toBe(401);
    expect((await send("DELETE", "/api/analytics/insights/goals", undefined, null)).status).toBe(401);
    expect((await send("POST", "/api/analytics/insights/export", { format: "csv", sections: ["products"] }, null)).status).toBe(401);
  });
});

describe("GET /products", () => {
  it("reports views, carts, purchases and conversion for the seller only", async () => {
    const body = await (await get("/api/analytics/insights/products?range=30d")).json() as any;
    expect(body.products).toHaveLength(1);
    const p = body.products[0];
    expect(p.productId).toBe(prodA);
    expect(p.views).toBe(10);
    expect(p.uniqueViewers).toBe(1);
    expect(p.addToCarts).toBe(4);
    expect(p.purchases).toBe(8);
    expect(p.viewToCartPct).toBe(40);
    expect(p.cartToPurchasePct).toBe(100); // capped
    expect(JSON.stringify(body)).not.toContain("Secret Hoodie");
  });
  it("respects the date range (the 60-day-old order is outside 30d but inside 90d)", async () => {
    const d30 = await (await get("/api/analytics/insights/products?range=30d")).json() as any;
    const d90 = await (await get("/api/analytics/insights/products?range=90d")).json() as any;
    expect(d90.totals.purchases).toBe(d30.totals.purchases + 1);
  });
  it("does not leak seller A data to seller B", async () => {
    const body = await (await get("/api/analytics/insights/products", B)).json() as any;
    expect(body.products.map((p: any) => p.productId)).toEqual([prodB]);
    expect(body.products[0].views).toBe(1);
  });
});

describe("GET /content", () => {
  it("aggregates real interactions, attribution and omits completion", async () => {
    const body = await (await get("/api/analytics/insights/content")).json() as any;
    expect(body.totals.views).toBe(4);
    expect(body.totals.likes).toBe(1);
    expect(body.totals.productClicks).toBe(1);
    expect(body.totals.avgWatchSeconds).toBe(15);
    expect(body.totals.purchases).toBe(1);
    expect(body.totals.revenueCents).toBe(5000);
    expect(body.totals.followerGrowth).toBe(1);
    expect(body.totals.completionRate).toBeNull();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].postId).toBe(postA);
    expect(body.posts[0].completionRate).toBeNull();
  });
  it("never includes another seller's posts", async () => {
    const body = await (await get("/api/analytics/insights/content", B)).json() as any;
    expect(body.posts.map((p: any) => p.caption)).toEqual(["B video"]);
    expect(body.totals.views).toBe(1);
  });
});

describe("GET /audience", () => {
  it("applies k-anonymity and splits new vs returning", async () => {
    const body = await (await get("/api/analytics/insights/audience?range=30d")).json() as any;
    expect(body.minGroupSize).toBe(5);
    // 7 buyers in range; buyer0 had a prior order -> 1 returning (<5, hidden), 6 new
    expect(body.buyers.returning).toBeNull();
    expect(body.buyers.suppressed).toBe(true);
    expect(body.topCountries).toEqual([{ country: "US", people: 6 }]); // DE (1 person) hidden
    expect(body.hiddenLocations).toBe(1);
    expect(JSON.stringify(body)).not.toContain("FR");
    expect(body).not.toHaveProperty("ageBands");
  });
  it("shows nothing for a seller with no audience", async () => {
    const body = await (await get("/api/analytics/insights/audience", B)).json() as any;
    expect(body.topCountries).toEqual([]);
    expect(body.buyers.new).toBeNull();
  });
});

describe("GET /best-time", () => {
  it("returns a 7x24 grid built from the seller's own engagement only", async () => {
    const body = await (await get("/api/analytics/insights/best-time?range=30d&tz=0")).json() as any;
    expect(body.grid).toHaveLength(7);
    expect(body.grid[0]).toHaveLength(24);
    // 4 post views + 1 like + 1 click + 2 watch_time? (watch_time excluded) + 10 product visits
    // come from A only; B's rows are not counted.
    const a = body.totalEvents;
    const b = (await (await get("/api/analytics/insights/best-time?range=30d&tz=0", B)).json() as any).totalEvents;
    expect(a).toBe(4 + 1 + 1 + 11); // views, like, shop_click, store visits (incl. forged-product row)
    expect(b).toBe(2);
    expect(body.recommended).toEqual([]); // below the minimum sample
  });
  it("shifts buckets with the tz offset", async () => {
    const utc = await (await get("/api/analytics/insights/best-time?tz=0")).json() as any;
    const shifted = await (await get("/api/analytics/insights/best-time?tz=-720")).json() as any;
    expect(shifted.grid).not.toEqual(utc.grid);
    expect(shifted.totalEvents).toBe(utc.totalEvents);
  });
});

describe("goals", () => {
  it("returns null, then creates, updates and clears a goal with pacing", async () => {
    expect((await (await get("/api/analytics/insights/goals")).json() as any).goal).toBeNull();
    const put = await send("PUT", "/api/analytics/insights/goals", { metric: "revenue", target: 100000 });
    expect(put.status).toBe(200);
    const g = (await put.json() as any).goal;
    expect(g).toMatchObject({ metric: "revenue", target: 100000 });
    expect(typeof g.actual).toBe("number");
    expect(g.month.daysInMonth).toBeGreaterThanOrEqual(28);
    const upd = await (await send("PUT", "/api/analytics/insights/goals", { metric: "orders", target: 50 })).json() as any;
    expect(upd.goal).toMatchObject({ metric: "orders", target: 50 });
    expect(await db.select().from(sellerGoals).where(eq(sellerGoals.sellerId, A))).toHaveLength(1);
    // another seller never sees it
    expect((await (await get("/api/analytics/insights/goals", B)).json() as any).goal).toBeNull();
    expect((await send("DELETE", "/api/analytics/insights/goals")).status).toBe(200);
    expect((await (await get("/api/analytics/insights/goals")).json() as any).goal).toBeNull();
  });
  it("validates input", async () => {
    for (const body of [{ metric: "profit", target: 5 }, { metric: "orders", target: 0 }, { metric: "orders", target: 1.5 }, { metric: "revenue", target: 5_000_000_000 }, {}]) {
      expect((await send("PUT", "/api/analytics/insights/goals", body)).status).toBe(400);
    }
  });
});

describe("POST /export", () => {
  it("produces a formula-safe CSV for the seller's own data", async () => {
    const res = await send("POST", "/api/analytics/insights/export", { format: "csv", range: "30d", sections: ["products", "audience"] });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mimeType).toBe("text/csv");
    expect(body.filename).toMatch(/\.csv$/);
    expect(body.data).toContain("'=Formula Tee"); // injection neutralised
    expect(body.data).not.toContain("Secret Hoodie");
    expect(body.data).toContain("Country: US");
    expect(body.data).not.toContain("Country: DE"); // k-anonymity holds in exports
  });
  it("produces a real PDF", async () => {
    const body = await (await send("POST", "/api/analytics/insights/export", { format: "pdf", sections: ["products", "content", "best_time", "goal"] })).json() as any;
    expect(body.encoding).toBe("base64");
    const buf = Buffer.from(body.data, "base64");
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
  it("rejects bad input", async () => {
    expect((await send("POST", "/api/analytics/insights/export", { format: "xls", sections: ["products"] })).status).toBe(400);
    expect((await send("POST", "/api/analytics/insights/export", { format: "csv", sections: [] })).status).toBe(400);
    expect((await send("POST", "/api/analytics/insights/export", { format: "csv", sections: ["orders"] })).status).toBe(400);
  });
});

describe("add-to-cart capture on POST /api/buyer/cart/sync", () => {
  const item = (variantId: string) => ({ variantId, quantity: 1, priceCents: 5000 });
  const count = async () => (await db.select().from(sellerProductEvents).where(eq(sellerProductEvents.sellerId, A))).filter((e) => e.viewerKey !== "k0" && !/^k\d$/.test(e.viewerKey));
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
