/**
 * F6 live-commerce: flash-deal expiry on live codes, the "just bought" ticker
 * (checkout → paid order → live room), the co-host bag, and 7-day shoppable
 * replays. Runs the real routers against the test database; auth and the
 * websocket hub are stubbed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  checkoutSessions, db, discountCodes, liveCohostProducts, liveCohosts, liveGiftPlatformFees, liveStreamOrders,
  liveStreams, orders, posts, productVariants, products, threadCashEntries, users,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
const broadcasts = vi.hoisted(() => [] as Array<{ streamId: string; payload: any }>);

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = auth.userId;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
  optionalAuth: (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/safety", async (orig) => ({
  ...(await orig<any>()),
  optionalViewerId: () => auth.userId || null,
}));
vi.mock("../../ws/liveHub", () => ({
  broadcastToRoom: (streamId: string, payload: any) => { broadcasts.push({ streamId, payload }); },
}));

let server: Server;
let base = "";
const p = `live-shop-${crypto.randomBytes(6).toString("hex")}`;
const host = `${p}-host`;
const cohost = `${p}-cohost`;
const buyer = `${p}-buyer`;
const stranger = `${p}-stranger`;
let streamId = "";
let hostProductId = "";
let cohostProductId = "";
let cohostOtherProductId = "";

async function request(path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function makeProduct(ownerId: string, name: string, priceCents: number): Promise<string> {
  const [row] = await db.insert(products).values({ ownerId, name, category: "apparel", status: "active", images: [`https://img.test/${name}.jpg`] })
    .returning({ id: products.id });
  await db.insert(productVariants).values({ productId: row.id, sku: `${p}-${crypto.randomUUID()}`, priceCents, stock: 3 });
  return row.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: host, email: `${host}@t.example`, name: "Host", brandName: "Atelier Host" },
    { clerkId: cohost, email: `${cohost}@t.example`, name: "Co", brandName: "Rue Studio" },
    { clerkId: buyer, email: `${buyer}@t.example`, name: "Ana Maria Lopez", displayName: "Ana Maria Lopez", username: `${p}-ana` },
    { clerkId: stranger, email: `${stranger}@t.example`, name: "Stranger" },
  ]);
  hostProductId = await makeProduct(host, "Linen Blazer", 18000);
  cohostProductId = await makeProduct(cohost, "Silk Scarf", 6500);
  cohostOtherProductId = await makeProduct(cohost, "Wool Coat", 32000);
  const [stream] = await db.insert(liveStreams).values({
    sellerId: host, channelName: `${p}-ch`, title: "Fall drop", status: "live",
    productTags: [{ productId: hostProductId, productName: "Linen Blazer", priceCents: 18000 }],
  } as any).returning({ id: liveStreams.id });
  streamId = stream.id;
  await db.insert(liveCohosts).values({ streamId, hostId: host, cohostId: cohost, status: "accepted" });

  const { default: liveShoppingRouter } = await import("../live-shopping");
  const { default: discountCodesRouter } = await import("../discount-codes");
  const { default: liveReplaysRouter } = await import("../live-replays");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/live", liveShoppingRouter);
  app.use("/api/discount-codes", (req, _res, next) => { (req as any).clerkUserId = auth.userId; next(); }, discountCodesRouter);
  app.use("/api/live-replays", liveReplaysRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const ids = [host, cohost, buyer, stranger];
  await db.delete(liveStreamOrders).where(eq(liveStreamOrders.streamId, streamId));
  await db.delete(liveCohostProducts).where(eq(liveCohostProducts.streamId, streamId));
  await db.delete(liveCohosts).where(eq(liveCohosts.streamId, streamId));
  await db.delete(liveGiftPlatformFees).where(eq(liveGiftPlatformFees.streamId, streamId));
  await db.delete(checkoutSessions).where(inArray(checkoutSessions.sellerId, ids));
  await db.delete(discountCodes).where(inArray(discountCodes.sellerId, ids));
  await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, ids));
  await db.delete(liveStreams).where(inArray(liveStreams.sellerId, ids));
  await db.delete(posts).where(inArray(posts.userId, ids));
  await db.delete(products).where(inArray(products.ownerId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
});

describe("live flash deals", () => {
  it("the server sets a live code's expiry from durationMinutes, and validation rejects it afterwards", async () => {
    auth.userId = host;
    const before = Date.now();
    const res = await request("/api/discount-codes", "POST", { type: "percentage", value: 20, liveStreamId: streamId, durationMinutes: 10 });
    expect(res.status).toBe(201);
    const code = await res.json() as any;
    const expires = Date.parse(code.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
    expect(broadcasts.some((b) => b.payload.type === "liveCode" && b.payload.code.expiresAt === code.expiresAt)).toBe(true);

    const { validateDiscountCode } = await import("../../lib/discounts");
    const input = { sellerId: host, code: code.code, customerKey: buyer, cartSubtotalCents: 18000, lines: [{ productId: hostProductId, priceCents: 18000, quantity: 1 }], liveStreamId: streamId };
    await expect(validateDiscountCode({ ...input, now: new Date(expires - 1000) })).resolves.toBeTruthy();
    await expect(validateDiscountCode({ ...input, now: new Date(expires + 1000) })).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("rejects durations outside 5/10/15 minutes and durations on non-live codes", async () => {
    auth.userId = host;
    expect((await request("/api/discount-codes", "POST", { type: "percentage", value: 20, liveStreamId: streamId, durationMinutes: 60 })).status).toBe(400);
    expect((await request("/api/discount-codes", "POST", { type: "percentage", value: 20, durationMinutes: 10 })).status).toBe(400);
  });
});

describe("co-host bag", () => {
  it("only an accepted co-host can add their own active products", async () => {
    auth.userId = stranger;
    expect((await request(`/api/live/${streamId}/cohost/products`, "PUT", { productIds: [cohostProductId] })).status).toBe(403);
    auth.userId = cohost;
    expect((await request(`/api/live/${streamId}/cohost/products`, "PUT", { productIds: [hostProductId] })).status).toBe(400);
    const ok = await request(`/api/live/${streamId}/cohost/products`, "PUT", { productIds: [cohostProductId, cohostOtherProductId] });
    expect(ok.status).toBe(200);
    expect(broadcasts.some((b) => b.streamId === streamId && b.payload.type === "bag")).toBe(true);
  });

  it("merges host tags and co-host products, each with its own seller", async () => {
    auth.userId = buyer;
    const res = await request(`/api/live/${streamId}/bag`);
    const { products: bag } = await res.json() as any;
    expect(bag.map((b: any) => b.productId)).toEqual([hostProductId, cohostProductId, cohostOtherProductId]);
    expect(bag[0]).toMatchObject({ sellerId: host, fromHost: true });
    expect(bag[1]).toMatchObject({ sellerId: cohost, sellerName: "Rue Studio", productName: "Silk Scarf", priceCents: 6500, fromHost: false });
  });

  it("drops a co-host's products once they leave the stage", async () => {
    await db.update(liveCohosts).set({ status: "left" }).where(eq(liveCohosts.streamId, streamId));
    const { products: bag } = await (await request(`/api/live/${streamId}/bag`)).json() as any;
    expect(bag.map((b: any) => b.productId)).toEqual([hostProductId]);
    await db.update(liveCohosts).set({ status: "accepted" }).where(eq(liveCohosts.streamId, streamId));
  });
});

describe("just-bought ticker", () => {
  async function checkout(sellerId: string, productName: string) {
    const [row] = await db.insert(checkoutSessions).values({
      buyerId: buyer, sellerId,
      items: [{ variantId: crypto.randomUUID(), productName, variantLabel: "M", quantity: 1, priceCents: 1000 }],
    } as any).returning({ id: checkoutSessions.id });
    return row.id;
  }

  it("links a checkout to the live only when its seller sells in that live", async () => {
    const { recordLiveCheckout } = await import("../../lib/livePurchases");
    const hostCs = await checkout(host, "Linen Blazer");
    const cohostCs = await checkout(cohost, "Silk Scarf");
    const strangerCs = await checkout(stranger, "Hat");
    expect(await recordLiveCheckout({ checkoutSessionId: hostCs, streamId, buyerId: buyer, sellerId: host })).toBe(true);
    expect(await recordLiveCheckout({ checkoutSessionId: cohostCs, streamId, buyerId: buyer, sellerId: cohost })).toBe(true);
    expect(await recordLiveCheckout({ checkoutSessionId: strangerCs, streamId, buyerId: buyer, sellerId: stranger })).toBe(false);
    expect(await recordLiveCheckout({ checkoutSessionId: strangerCs, streamId: "not-a-uuid", buyerId: buyer, sellerId: host })).toBe(false);
  });

  it("announces a paid order once, with first name + product only", async () => {
    const { recordLiveCheckout } = await import("../../lib/livePurchases");
    const { announceLivePurchase } = await import("../../lib/liveAttribution");
    const cs = await checkout(host, "Linen Blazer");
    await recordLiveCheckout({ checkoutSessionId: cs, streamId, buyerId: buyer, sellerId: host });
    const orderId = crypto.randomUUID();
    await db.insert(orders).values({
      id: orderId, ownerId: host, buyerId: buyer, orderNumber: `live-${crypto.randomUUID()}`,
      status: 'paid', totalCents: 1000, subtotalCents: 1000, sourceLiveStreamId: streamId,
    } as any);
    try {
      await announceLivePurchase(orderId, cs);
      await announceLivePurchase(orderId, cs);
      const sent = broadcasts.filter((b) => b.payload.type === "purchase" && b.streamId === streamId);
      expect(sent).toHaveLength(1);
      expect(sent[0].payload.purchase).toMatchObject({ name: "Ana", text: "just bought Linen Blazer" });
      expect(sent[0].streamId).toBe(streamId);
      expect(JSON.stringify(sent[0].payload)).not.toContain("Lopez");
    } finally {
      await db.delete(orders).where(eq(orders.id, orderId));
    }
    // A checkout that wasn't from a live announces nothing.
    const sentCount = broadcasts.length;
    await announceLivePurchase(crypto.randomUUID(), await checkout(host, "Other"));
    expect(broadcasts).toHaveLength(sentCount);
  });

  it("serves purchases and gifts to polling clients", async () => {
    await db.insert(liveGiftPlatformFees).values({
      giftEntryId: crypto.randomUUID(), streamId, buyerId: buyer, sellerId: host,
      grossCents: 500, feeBps: 3000, feeCents: 150, netCents: 350,
    });
    auth.userId = stranger;
    const since = new Date(Date.now() - 60_000).toISOString();
    const body = await (await request(`/api/live/${streamId}/activity?since=${encodeURIComponent(since)}`)).json() as any;
    expect(body.error).toBeUndefined();
    const { activity } = body;
    expect(activity.some((a: any) => a.kind === "purchase" && a.text === "just bought Linen Blazer" && a.name === "Ana")).toBe(true);
    expect(activity.some((a: any) => a.kind === "gift" && a.text === "sent $5 Thread Cash" && a.name === "Ana")).toBe(true);
    const later = new Date(Date.now() + 60_000).toISOString();
    const none = await (await request(`/api/live/${streamId}/activity?since=${encodeURIComponent(later)}`)).json() as any;
    expect(none.activity).toEqual([]);
  });
});

describe("7-day shoppable replays", () => {
  async function replayFor(endedDaysAgo: number) {
    const [post] = await db.insert(posts).values({ userId: host, mediaUrl: "https://example.test/r.mp4", caption: "replay" }).returning({ id: posts.id });
    const ended = new Date(Date.now() - endedDaysAgo * 86_400_000);
    const [row] = await db.insert(liveStreams).values({
      sellerId: host, channelName: `${p}-r-${crypto.randomUUID()}`, title: "Replay", status: "ended",
      productTags: [{ productId: hostProductId, productName: "Linen Blazer", priceCents: 18000 }],
      replayUrl: "https://cdn.test/r.mp4", replayPostId: post.id,
      startedAt: new Date(ended.getTime() - 3600_000), endedAt: ended,
    } as any).returning({ id: liveStreams.id });
    return row.id;
  }

  it("returns the live's products with a fresh replay", async () => {
    const id = await replayFor(2);
    auth.userId = buyer;
    const res = await request(`/api/live-replays/${id}`);
    expect(res.status).toBe(200);
    const { replay } = await res.json() as any;
    expect(replay.expired).toBe(false);
    expect(replay.products).toEqual([expect.objectContaining({ productId: hostProductId, name: "Linen Blazer", priceCents: 18000, sellerId: host })]);
  });

  it("hides a replay older than 7 days from buyers but keeps it, expired and not shoppable, for the owner", async () => {
    const id = await replayFor(8);
    auth.userId = buyer;
    expect((await request(`/api/live-replays/${id}`)).status).toBe(404);
    const list = await (await request(`/api/live-replays/by-seller/${host}`)).json() as any;
    expect(list.replays.map((r: any) => r.streamId)).not.toContain(id);
    auth.userId = host;
    const own = await (await request(`/api/live-replays/${id}`)).json() as any;
    expect(own.replay).toMatchObject({ expired: true, products: [] });
    const ownList = await (await request(`/api/live-replays/by-seller/${host}`)).json() as any;
    expect(ownList.replays.find((r: any) => r.streamId === id)).toMatchObject({ expired: true });
  });
});

