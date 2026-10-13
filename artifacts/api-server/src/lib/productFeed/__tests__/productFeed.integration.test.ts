import {getWebOrigin} from "../../webOrigin";
/**
 * Seller product feed against real Postgres: secret URL lifecycle (create,
 * re-read, regenerate revokes), what the public CSV contains and never
 * contains, eligibility (drafts, deleted, other sellers, suspended seller),
 * fetch stamps, and auth on the seller routes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../middlewares/requireRole")>();
  return { ...actual, requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { db, productFeeds, products, productVariants, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { call, seedProduct, seedSeller, startApp } from "../../money/__tests__/moneyHarness";
import { publicProductFeedRouter, sellerProductFeedRouter } from "../../../routes/product-feed";
import { clearFeedCache } from "../service";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  vi.stubEnv("PRODUCT_FEEDS_ENABLED", "1");
  app = await startApp((server) => {
    server.use("/api/seller/product-feed", sellerProductFeedRouter);
    server.use("/api/v1/public/feeds", publicProductFeedRouter);
  });
});
afterAll(async () => { await app?.close(); });

const pathOf = (url: string) => new URL(url).pathname;

async function fetchFeed(url: string) {
  const r = await fetch(`${app.base}${pathOf(url)}`);
  return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), robots: r.headers.get("x-robots-tag"), text: await r.text() };
}

async function seedListed(sellerId: string, priceCents: number, extra: Partial<typeof products.$inferInsert> = {}) {
  const p = await seedProduct(sellerId, { priceCents });
  await db.update(products).set({ images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"], description: "Soft tee", ...extra })
    .where(eq(products.id, p.productId));
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, p.variantId));
  return { ...p, sku: v.sku };
}

describe("seller product feed URL", () => {
  it("requires sign-in", async () => {
    expect((await call(app.base, "GET", "/api/seller/product-feed", "")).status).toBe(401);
    expect((await call(app.base, "POST", "/api/seller/product-feed", "")).status).toBe(401);
    expect((await call(app.base, "POST", "/api/seller/product-feed/regenerate", "")).status).toBe(401);
  });

  it("has no URL until created, then shows the same URL again with product counts", async () => {
    const seller = await seedSeller("feed-create");
    await seedListed(seller, 1200);
    const before = await call(app.base, "GET", "/api/seller/product-feed", seller);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ feed: null, productCount: 1, itemCount: 1 });

    const created = await call(app.base, "POST", "/api/seller/product-feed", seller);
    expect(created.status).toBe(201);
    expect(new URL(created.body.feed.metaUrl).origin).toBe(getWebOrigin());
    expect(new URL(created.body.feed.metaUrl).pathname).toMatch(/^\/api\/v1\/public\/feeds\/[A-Za-z0-9_-]{43}\/meta\.csv$/);
    expect(created.body.feed.tiktokUrl).toBe(created.body.feed.metaUrl.replace("meta.csv", "tiktok.csv"));

    const again = await call(app.base, "POST", "/api/seller/product-feed", seller);
    expect(again.status).toBe(200);
    expect(again.body.feed.metaUrl).toBe(created.body.feed.metaUrl);
    const read = await call(app.base, "GET", "/api/seller/product-feed", seller);
    expect(read.body.feed.metaUrl).toBe(created.body.feed.metaUrl);
  });

  it("regenerating revokes the old URL immediately", async () => {
    const seller = await seedSeller("feed-rotate");
    await seedListed(seller, 1500);
    const first = (await call(app.base, "POST", "/api/seller/product-feed", seller)).body.feed;
    expect((await fetchFeed(first.metaUrl)).status).toBe(200);
    const next = await call(app.base, "POST", "/api/seller/product-feed/regenerate", seller);
    expect(next.status).toBe(200);
    expect(next.body.feed.metaUrl).not.toBe(first.metaUrl);
    expect((await fetchFeed(first.metaUrl)).status).toBe(404);
    expect((await fetchFeed(first.tiktokUrl)).status).toBe(404);
    expect((await fetchFeed(next.body.feed.tiktokUrl)).status).toBe(200);
    const [row] = await db.select().from(productFeeds).where(eq(productFeeds.sellerId, seller));
    expect(row.metaFetchedAt).toBeNull();
  });
});

describe("public feed CSV", () => {
  it("serves only published, non-deleted products of this seller with Meta columns and no private fields", async () => {
    const seller = await seedSeller("feed-meta");
    const other = await seedSeller("feed-other");
    const listed = await seedListed(seller, 1999);
    await db.update(productVariants).set({ compareAtPriceCents: 2999, stock: 7 }).where(eq(productVariants.id, listed.variantId));
    const draft = await seedListed(seller, 1000, { status: "draft" });
    const deleted = await seedListed(seller, 1000, { deletedAt: new Date() });
    const foreign = await seedListed(other, 1000);
    const noImage = await seedListed(seller, 1000, { images: [] });

    const feed = (await call(app.base, "POST", "/api/seller/product-feed", seller)).body.feed;
    const res = await fetchFeed(feed.metaUrl);
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/csv");
    expect(res.cache).toContain("private");
    expect(res.robots).toContain("noindex");
    const lines = res.text.trimEnd().split("\n");
    expect(lines[0]).toBe("id,title,description,availability,condition,price,link,image_link,brand,additional_image_link,item_group_id,sale_price,google_product_category,size,color");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(listed.variantId);
    expect(lines[1]).toContain(`,${listed.productId},`);
    expect(lines[1]).toContain("29.99 USD");
    expect(lines[1]).toContain("19.99 USD");
    expect(lines[1]).toContain(`${getWebOrigin()}/store/product/${listed.productId}`);
    expect(lines[1]).toContain("in stock");
    for (const hidden of [draft, deleted, foreign, noImage]) expect(res.text).not.toContain(hidden.productId);
    expect(res.text).not.toContain(listed.sku);
    expect(res.text).not.toContain(seller);

    const [row] = await db.select().from(productFeeds).where(eq(productFeeds.sellerId, seller));
    expect(row.metaFetchedAt).toBeInstanceOf(Date);
    expect(row.tiktokFetchedAt).toBeNull();
    const overview = await call(app.base, "GET", "/api/seller/product-feed", seller);
    expect(overview.body.feed.metaFetchedAt).toBeTruthy();
  });

  it("serves the TikTok catalog columns with sku_id", async () => {
    const seller = await seedSeller("feed-tiktok");
    const listed = await seedListed(seller, 2500);
    const feed = (await call(app.base, "POST", "/api/seller/product-feed", seller)).body.feed;
    const res = await fetchFeed(feed.tiktokUrl);
    expect(res.status).toBe(200);
    const [header, row] = res.text.trimEnd().split("\n");
    expect(header.split(",").slice(0, 9)).toEqual(["sku_id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"]);
    expect(row.startsWith(`${listed.variantId},`)).toBe(true);
    expect(row).toContain("25.00 USD");
  });

  it("a suspended seller's feed is empty, and unknown or malformed tokens are 404", async () => {
    const seller = await seedSeller("feed-suspended");
    await seedListed(seller, 1000);
    const feed = (await call(app.base, "POST", "/api/seller/product-feed", seller)).body.feed;
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.clerkId, seller));
    await clearFeedCache(seller);
    const res = await fetchFeed(feed.metaUrl);
    expect(res.status).toBe(200);
    expect(res.text.trimEnd().split("\n")).toHaveLength(1);

    expect((await fetch(`${app.base}/api/v1/public/feeds/${"a".repeat(43)}/meta.csv`)).status).toBe(404);
    expect((await fetch(`${app.base}/api/v1/public/feeds/short/meta.csv`)).status).toBe(404);
  });

  it("serves from cache until the cache is cleared", async () => {
    const seller = await seedSeller("feed-cache");
    await seedListed(seller, 1000);
    const feed = (await call(app.base, "POST", "/api/seller/product-feed", seller)).body.feed;
    expect((await fetchFeed(feed.metaUrl)).text.trimEnd().split("\n")).toHaveLength(2);
    await seedListed(seller, 3000);
    expect((await fetchFeed(feed.metaUrl)).text.trimEnd().split("\n")).toHaveLength(2);
    await clearFeedCache(seller);
    expect((await fetchFeed(feed.metaUrl)).text.trimEnd().split("\n")).toHaveLength(3);
  });
});
