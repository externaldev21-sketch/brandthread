/**
 * App Store 1.2 follow-ups against the real development database:
 *  - blocking removes the blocked seller's products/videos from every public
 *    browse endpoint for the blocker (list, related, detail, high-demand,
 *    search videos, trending, discover feed), in both directions;
 *  - a member report reaches the moderation queue with a 24-hour due-by and
 *    the queue summary counts overdue items.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import {
  blocks, db, postTaggedProducts, posts, productVariants, products, reports, sellerRankingCache, trendingCache, users,
} from "@workspace/db";

vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: () => void) => {
      const userId = req.header("x-test-user-id");
      if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
      req.clerkUserId = userId;
      next();
    },
  };
});
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_req: any, _res: any, next: () => void) => next() }));
vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header?.("x-test-user-id") || null, sessionId: null }),
  clerkClient: { users: { banUser: async () => undefined, unbanUser: async () => undefined } },
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async trySetObjectEntityAclPolicy(path: string) { return path; }
    async getObjectEntityDownloadURL(path: string) { return `https://signed.test/${encodeURIComponent(path)}`; }
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

const RUN = `blk${crypto.randomBytes(5).toString("hex")}`;
const BLOCKED_SELLER = `${RUN}_blocked`;
const OTHER_SELLER = `${RUN}_other`;
const VIEWER = `${RUN}_viewer`;
const ADMIN = `${RUN}_admin`;
let server: Server;
let base = "";
let blockedProduct = "";
let otherProduct = "";
let blockedVideo = "";

async function call(path: string, options: { method?: string; user?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.user) headers["x-test-user-id"] = options.user;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET", headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any, headers: response.headers };
}

const ids = (list: any[]) => list.map((row) => row.id);

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: BLOCKED_SELLER, email: `${BLOCKED_SELLER}@example.test`, name: "Blocked Seller", brandName: `Zorblax ${RUN}`, accountType: "seller", role: "owner", username: `${RUN}a` },
    { clerkId: OTHER_SELLER, email: `${OTHER_SELLER}@example.test`, name: "Other Seller", brandName: `Zorblax ${RUN} Two`, accountType: "seller", role: "owner", username: `${RUN}c` },
    { clerkId: VIEWER, email: `${VIEWER}@example.test`, name: "Viewer", accountType: "buyer", role: "buyer", username: `${RUN}v` },
    { clerkId: ADMIN, email: `${ADMIN}@example.test`, name: "Moderator", accountType: "buyer", role: "admin" },
  ]);
  const [bp, op] = await db.insert(products).values([
    { ownerId: BLOCKED_SELLER, name: `Zorblax tee ${RUN}`, status: "active", category: "apparel", tags: ["zorblax"] },
    { ownerId: OTHER_SELLER, name: `Zorblax hoodie ${RUN}`, status: "active", category: "apparel", tags: ["zorblax"] },
  ]).returning({ id: products.id });
  blockedProduct = bp.id;
  otherProduct = op.id;
  await db.insert(productVariants).values([
    { productId: blockedProduct, sku: `${RUN}-a`, priceCents: 2000, stock: 5 },
    { productId: otherProduct, sku: `${RUN}-b`, priceCents: 3000, stock: 5 },
  ]);
  const [video] = await db.insert(posts).values({
    userId: BLOCKED_SELLER, mediaUrl: "https://cdn.test/v.mp4", mediaType: "video", caption: `zorblax video ${RUN}`,
    postStatus: "published", publishedAt: new Date(),
  }).returning({ id: posts.id });
  blockedVideo = video.id;
  await db.insert(postTaggedProducts).values({ postId: blockedVideo, productId: otherProduct }).onConflictDoNothing();
  await db.insert(blocks).values({ blockerId: VIEWER, blockedId: BLOCKED_SELLER });

  const today = new Date().toISOString().slice(0, 10);
  await db.insert(trendingCache).values({
    cacheDate: today, results: [{ id: "t1", brandId: BLOCKED_SELLER }, { id: "t2", brandId: OTHER_SELLER }], itemCount: 2,
  }).onConflictDoUpdate({ target: trendingCache.cacheDate, set: { results: [{ id: "t1", brandId: BLOCKED_SELLER }, { id: "t2", brandId: OTHER_SELLER }], itemCount: 2, computedAt: new Date() } });
  await db.insert(sellerRankingCache).values({
    cacheDate: today, results: [{ productId: "p1", brandId: BLOCKED_SELLER }, { productId: "p2", brandId: OTHER_SELLER }], itemCount: 2,
  }).onConflictDoUpdate({ target: sellerRankingCache.cacheDate, set: { results: [{ productId: "p1", brandId: BLOCKED_SELLER }, { productId: "p2", brandId: OTHER_SELLER }], itemCount: 2, computedAt: new Date() } });

  const { default: publicRouter } = await import("../public");
  const { default: reportsRouter } = await import("../reports");
  const { default: moderationRouter } = await import("../moderation");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/public", publicRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/moderation", moderationRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const userIds = [BLOCKED_SELLER, OTHER_SELLER, VIEWER, ADMIN];
  await db.delete(reports).where(inArray(reports.reporterId, userIds));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(posts).where(eq(posts.userId, BLOCKED_SELLER));
  await db.delete(products).where(inArray(products.ownerId, [BLOCKED_SELLER, OTHER_SELLER]));
  await db.delete(users).where(like(users.clerkId, `${RUN}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("blocking removes the blocked seller from public browse endpoints", () => {
  it("product list (by category) hides them for the blocker only", async () => {
    const viewer = await call("/api/public/products?category=apparel&limit=100", { user: VIEWER });
    expect(ids(viewer.body)).not.toContain(blockedProduct);
    expect(ids(viewer.body)).toContain(otherProduct);
    expect(viewer.headers.get("cache-control")).toContain("private");
    const anonymous = await call("/api/public/products?category=apparel&limit=100");
    expect(ids(anonymous.body)).toEqual(expect.arrayContaining([blockedProduct, otherProduct]));
    expect(anonymous.headers.get("cache-control")).toContain("public");
  });

  it("product detail is a 404 and related products exclude them", async () => {
    expect((await call(`/api/public/products/${blockedProduct}`, { user: VIEWER })).status).toBe(404);
    expect((await call(`/api/public/products/${blockedProduct}`)).status).toBe(200);
    const related = await call(`/api/public/products/${otherProduct}/related?limit=24`, { user: VIEWER });
    expect(ids(related.body)).not.toContain(blockedProduct);
    const relatedAnon = await call(`/api/public/products/${otherProduct}/related?limit=24`);
    expect(ids(relatedAnon.body)).toContain(blockedProduct);
  });

  it("applies in both directions (the blocked seller no longer sees the blocker's content either)", async () => {
    const [vp] = await db.insert(products).values({ ownerId: VIEWER, name: `Viewer item ${RUN}`, status: "active", category: "apparel" }).returning({ id: products.id });
    const asBlocked = await call("/api/public/products?category=apparel&limit=100", { user: BLOCKED_SELLER });
    expect(ids(asBlocked.body)).not.toContain(vp.id);
    await db.delete(products).where(eq(products.id, vp.id));
  });

  it("search hides their brand, products and videos", async () => {
    const q = `/api/public/search?q=zorblax%20${RUN}`;
    const viewer = await call(q, { user: VIEWER });
    expect(viewer.status).toBe(200);
    const seen = ids(viewer.body.results);
    expect(seen).not.toContain(blockedProduct);
    expect(seen).not.toContain(blockedVideo);
    expect(seen).not.toContain(BLOCKED_SELLER);
    expect(seen).toContain(otherProduct);
    const anon = ids((await call(q)).body.results);
    expect(anon).toEqual(expect.arrayContaining([blockedProduct, blockedVideo, BLOCKED_SELLER]));
  });

  it("videos tagged on a product exclude the blocked author", async () => {
    const viewer = await call(`/api/public/products/${otherProduct}/videos`, { user: VIEWER });
    expect(viewer.body.map((v: any) => v.postId)).not.toContain(blockedVideo);
    const anon = await call(`/api/public/products/${otherProduct}/videos`);
    expect(anon.body.map((v: any) => v.postId)).toContain(blockedVideo);
  });

  it("trending and discover feed drop the blocked seller from the shared daily cache", async () => {
    const trending = await call("/api/public/trending", { user: VIEWER });
    expect(trending.body.trending.map((t: any) => t.brandId)).not.toContain(BLOCKED_SELLER);
    const trendingAnon = await call("/api/public/trending");
    expect(trendingAnon.body.trending.map((t: any) => t.brandId)).toContain(BLOCKED_SELLER);

    const discover = await call("/api/public/discover/feed", { user: VIEWER });
    expect(discover.body.items.map((t: any) => t.brandId)).not.toContain(BLOCKED_SELLER);
    const discoverAnon = await call("/api/public/discover/feed");
    expect(discoverAnon.body.items.map((t: any) => t.brandId)).toContain(BLOCKED_SELLER);
  });
});

describe("reports reach the moderation queue with a 24-hour due-by", () => {
  it("creates the report, lists it with dueBy = createdAt + 24h, and counts overdue ones", async () => {
    const created = await call("/api/reports", {
      method: "POST", user: VIEWER,
      body: { targetType: "product", targetId: otherProduct, reason: "ip_counterfeit", note: "Looks like a fake" },
    });
    expect(created.status).toBe(201);

    const queue = await call("/api/moderation/reports?status=open", { user: ADMIN });
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((i: any) => i.id === created.body.id);
    expect(item).toBeTruthy();
    expect(item.reason).toBe("ip_counterfeit");
    expect(new Date(item.dueBy).getTime() - new Date(item.createdAt).getTime()).toBe(24 * 3_600_000);
    const overdueBefore = queue.body.summary.overdue;

    await db.update(reports).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(reports.id, created.body.id));
    const later = await call("/api/moderation/reports?status=open", { user: ADMIN });
    expect(later.body.summary.overdue).toBe(overdueBefore + 1);
    expect(new Date(later.body.items.find((i: any) => i.id === created.body.id).dueBy).getTime()).toBeLessThan(Date.now());
  });
});
