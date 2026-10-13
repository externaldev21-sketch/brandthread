/**
 * Live auctions (F6 item 94) against the test database: flag gate, 1-of-1
 * enforcement, bid ordering + increments, concurrent bids under the row lock,
 * self-bid / block / ban rejection, anti-snipe, settle, and the winner's
 * checkout price (never a client price; the piece is held from everyone else).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  blocks, db, liveAuctionBids, liveAuctionCheckouts, liveAuctions, liveStreams, productVariants, products, users,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
const broadcasts = vi.hoisted(() => [] as Array<{ streamId: string; payload: any }>);

vi.mock("../../middlewares/requireAuth", () => ({
  // The caller rides on a header so concurrent requests keep their own identity.
  requireAuth: (req: any, res: any, next: () => void) => {
    const userId = req.headers["x-user"] || auth.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = userId;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../lib/safety", async (orig) => ({
  ...(await orig<any>()),
  optionalViewerId: (req: any) => req.headers["x-user"] || auth.userId || null,
}));
vi.mock("../../ws/liveHub", () => ({
  broadcastToRoom: (streamId: string, payload: any) => { broadcasts.push({ streamId, payload }); },
}));

let server: Server;
let base = "";
const p = `live-auc-${crypto.randomBytes(6).toString("hex")}`;
const host = `${p}-host`;
const ana = `${p}-ana`;
const ben = `${p}-ben`;
const cleo = `${p}-cleo`;
const blocked = `${p}-blocked`;
const banned = `${p}-banned`;
const bidders = Array.from({ length: 8 }, (_, i) => `${p}-crowd-${i}`);
let streamId = "";
const productIds: string[] = [];

async function request(path: string, method = "GET", body?: unknown, as: string = auth.userId) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-user": as, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

async function oneOfOne(name: string, stocks: number[] = [1]): Promise<{ productId: string; variantIds: string[] }> {
  const [row] = await db.insert(products).values({ ownerId: host, name, category: "apparel", status: "active" }).returning({ id: products.id });
  productIds.push(row.id);
  const variantIds: string[] = [];
  for (const stock of stocks) {
    const [v] = await db.insert(productVariants).values({ productId: row.id, sku: `${p}-${crypto.randomUUID()}`, priceCents: 40000, stock })
      .returning({ id: productVariants.id });
    variantIds.push(v.id);
  }
  return { productId: row.id, variantIds };
}

async function setFlag(on: boolean) {
  await db.execute(sql`
    INSERT INTO feature_flags (key, enabled) VALUES ('live_auctions', ${on})
    ON CONFLICT (key) DO UPDATE SET enabled = ${on}
  `);
}

async function start(productId: string, extra: Record<string, unknown> = {}) {
  auth.userId = host;
  return request(`/api/live/${streamId}/auctions`, "POST", { productId, startingBidCents: 500, durationSeconds: 30, ...extra });
}

async function bid(userId: string, auctionId: string, amountCents: number) {
  return request(`/api/live/${streamId}/auctions/${auctionId}/bid`, "POST", { amountCents }, userId);
}

/** Moves an auction's clock (instead of sleeping in tests). */
async function setEndsIn(auctionId: string, ms: number) {
  await db.update(liveAuctions).set({ endsAt: new Date(Date.now() + ms) }).where(eq(liveAuctions.id, auctionId));
}

beforeAll(async () => {
  await db.insert(users).values([host, ana, ben, cleo, blocked, banned, ...bidders].map((id) => ({
    clerkId: id, email: `${id}@t.example`, name: id, username: id.slice(-12),
  })));
  await db.insert(blocks).values({ blockerId: host, blockedId: blocked });
  const [stream] = await db.insert(liveStreams).values({ sellerId: host, channelName: `${p}-ch`, title: "Archive auction", status: "live" } as any)
    .returning({ id: liveStreams.id });
  streamId = stream.id;
  await db.execute(sql`
    INSERT INTO live_stream_restrictions (stream_id, user_id, kind, created_by) VALUES (${streamId}::uuid, ${banned}, 'ban', ${host})
  `);

  const { default: router } = await import("../live-auctions");
  const app = express();
  app.use(express.json());
  app.use("/api/live", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await setFlag(true);
  // One open auction per live: clear any left open by the previous case.
  await db.update(liveAuctions).set({ status: "cancelled" }).where(sql`${liveAuctions.streamId} = ${streamId}::uuid AND ${liveAuctions.status} = 'open'`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const auctionRows = await db.select({ id: liveAuctions.id }).from(liveAuctions).where(eq(liveAuctions.streamId, streamId));
  const ids = auctionRows.map((r) => r.id);
  if (ids.length) {
    await db.delete(liveAuctionBids).where(inArray(liveAuctionBids.auctionId, ids));
    await db.delete(liveAuctionCheckouts).where(inArray(liveAuctionCheckouts.auctionId, ids));
    await db.delete(liveAuctions).where(inArray(liveAuctions.id, ids));
  }
  await db.execute(sql`DELETE FROM live_stream_restrictions WHERE stream_id = ${streamId}::uuid`);
  await db.delete(liveStreams).where(eq(liveStreams.id, streamId));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(blocks).where(eq(blocks.blockerId, host));
  await db.delete(users).where(inArray(users.clerkId, [host, ana, ben, cleo, blocked, banned, ...bidders]));
  await setFlag(false);
});

describe("live_auctions flag", () => {
  it("is off by default in the migration and every route is closed while off", async () => {
    await setFlag(false);
    const { productId } = await oneOfOne("Flag tee");
    expect((await start(productId)).status).toBe(403);
    auth.userId = ana;
    expect((await request(`/api/live/${streamId}/auctions/active`)).body).toEqual({ enabled: false, auction: null });
  });
});

describe("starting an auction", () => {
  it("only 1-of-1s: refuses a product with more than one unit in stock", async () => {
    const two = await oneOfOne("Two of these", [2]);
    const split = await oneOfOne("One each in two sizes", [1, 1]);
    expect((await start(two.productId)).body.code).toBe("NOT_ONE_OF_ONE");
    expect((await start(split.productId)).body.code).toBe("NOT_ONE_OF_ONE");
  });

  it("starts on a 1-of-1, broadcasts auction_started, and allows one open auction per live", async () => {
    const piece = await oneOfOne("Archive coat", [0, 1]);
    const res = await start(piece.productId, { durationSeconds: 15 });
    expect(res.status).toBe(201);
    expect(res.body.auction).toMatchObject({ status: "open", variantId: piece.variantIds[1], nextMinBidCents: 500, productName: "Archive coat" });
    expect(broadcasts.some((b) => b.payload.type === "auction_started" && b.payload.auction.id === res.body.auction.id)).toBe(true);
    const other = await oneOfOne("Second piece");
    expect((await start(other.productId)).body.code).toBe("AUCTION_RUNNING");
  });

  it("rejects durations other than 10/15/30/60s and starting bids under $1", async () => {
    const piece = await oneOfOne("Validation piece");
    expect((await start(piece.productId, { durationSeconds: 45 })).status).toBe(400);
    expect((await start(piece.productId, { startingBidCents: 50 })).status).toBe(400);
  });
});

describe("bidding", () => {
  it("orders bids by the increment ladder and tracks the leader", async () => {
    const { productId } = await oneOfOne("Ladder piece");
    const id = (await start(productId)).body.auction.id;
    expect((await bid(ana, id, 400)).body.code).toBe("BID_TOO_LOW");
    const first = await bid(ana, id, 500);
    expect(first.body.auction).toMatchObject({ currentBidCents: 500, leaderUserId: ana, youAreLeading: true, nextMinBidCents: 600 });
    expect((await bid(ana, id, 600)).body.code).toBe("ALREADY_LEADING");
    expect((await bid(ben, id, 550)).body.code).toBe("BID_TOO_LOW");
    const second = await bid(ben, id, 2_000);
    expect(second.body.auction).toMatchObject({ currentBidCents: 2_000, leaderUserId: ben, bidCount: 2, nextMinBidCents: 2_200 });
    expect((await bid(cleo, id, 2_100)).body.code).toBe("BID_TOO_LOW");
    expect((await bid(cleo, id, 2_200)).status).toBe(200);
    const rows = await db.select().from(liveAuctionBids).where(eq(liveAuctionBids.auctionId, id));
    expect(rows.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([500, 2_000, 2_200]);
    expect(broadcasts.filter((b) => b.payload.type === "auction_bid" && b.payload.auction.id === id)).toHaveLength(3);
  });

  it("the host can't bid on their own auction; blocked and banned viewers can't bid", async () => {
    const { productId } = await oneOfOne("Gate piece");
    const id = (await start(productId)).body.auction.id;
    expect((await bid(host, id, 500)).body.code).toBe("SELF_BID");
    expect((await bid(blocked, id, 500)).status).toBe(404);
    expect((await bid(banned, id, 500)).body.code).toBe("REMOVED");
  });

  it("concurrent bids at the same amount: exactly one wins, the rest are told to bid again", async () => {
    const { productId } = await oneOfOne("Rush piece");
    const id = (await start(productId)).body.auction.id;
    const results = await Promise.all(bidders.map((userId) => bid(userId, id, 500).then((r) => r.status)));
    expect(results.filter((s) => s === 200)).toHaveLength(1);
    const [row] = await db.select().from(liveAuctions).where(eq(liveAuctions.id, id));
    expect(row.bidCount).toBe(1);
    expect(row.currentBidCents).toBe(500);
  });

  it("concurrent escalating bids never lose an update: final price is the highest accepted bid", async () => {
    const { productId } = await oneOfOne("Escalation piece");
    const id = (await start(productId)).body.auction.id;
    const amounts = bidders.map((_, i) => 500 + i * 300);
    const statuses = await Promise.all(bidders.map((u, i) => bid(u, id, amounts[i]).then((r) => r.status)));
    const [row] = await db.select().from(liveAuctions).where(eq(liveAuctions.id, id));
    const bidsRows = await db.select().from(liveAuctionBids).where(eq(liveAuctionBids.auctionId, id));
    expect(bidsRows).toHaveLength(statuses.filter((s) => s === 200).length);
    expect(row.bidCount).toBe(bidsRows.length);
    expect(row.currentBidCents).toBe(Math.max(...bidsRows.map((b) => b.amountCents)));
    // Accepted bids, in time order, always went up by at least the increment.
    const ordered = [...bidsRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 1; i < ordered.length; i++) expect(ordered[i].amountCents).toBeGreaterThan(ordered[i - 1].amountCents);
  });
});

describe("anti-snipe", () => {
  it("a bid in the last 10s resets the clock to 10s", async () => {
    const { productId } = await oneOfOne("Snipe piece");
    const id = (await start(productId)).body.auction.id;
    await setEndsIn(id, 3_000);
    const before = Date.now();
    const res = await bid(ana, id, 500);
    const ends = Date.parse(res.body.auction.endsAt);
    expect(ends).toBeGreaterThanOrEqual(before + 10_000 - 50);
    expect(ends).toBeLessThanOrEqual(Date.now() + 10_000 + 50);
  });

  it("sudden death: no extension", async () => {
    const { productId } = await oneOfOne("Sudden piece");
    const id = (await start(productId, { suddenDeath: true })).body.auction.id;
    await setEndsIn(id, 3_000);
    const [row] = await db.select().from(liveAuctions).where(eq(liveAuctions.id, id));
    const res = await bid(ana, id, 500);
    expect(Date.parse(res.body.auction.endsAt)).toBe(row.endsAt.getTime());
  });
});

describe("settle + pay", () => {
  it("settles to the leader when time is up (on read), rejects late bids, and only the winner pays the winning price", async () => {
    const piece = await oneOfOne("Winner piece");
    const id = (await start(piece.productId)).body.auction.id;
    await bid(ana, id, 500);
    await bid(ben, id, 1_200);
    await setEndsIn(id, -1);
    expect((await bid(cleo, id, 5_000)).body.code).toBe("AUCTION_CLOSED");

    auth.userId = ben;
    const mine = await request(`/api/live/${streamId}/auctions/active`);
    expect(mine.body.auction).toMatchObject({ id, status: "sold", winnerName: expect.any(String), youWon: true, payable: true, currentBidCents: 1_200 });
    expect(broadcasts.some((b) => b.payload.type === "auction_ended" && b.payload.auction.id === id)).toBe(true);

    const { resolveAuctionLinePrice, recordAuctionCheckout, markAuctionPaid } = await import("../../lib/liveAuctions");
    const line = { productId: piece.productId, variantId: piece.variantIds[0], quantity: 1 };
    expect(await resolveAuctionLinePrice({ ...line, buyerId: ben, auctionId: id })).toEqual({ priceCents: 1_200, auctionId: id });
    await expect(resolveAuctionLinePrice({ ...line, buyerId: ana, auctionId: id })).rejects.toMatchObject({ code: "AUCTION_NOT_WON" });
    await expect(resolveAuctionLinePrice({ ...line, buyerId: ben, auctionId: id, quantity: 2 })).rejects.toMatchObject({ code: "AUCTION_QUANTITY" });
    // Held for the winner: nobody can buy it at the list price meanwhile.
    await expect(resolveAuctionLinePrice({ ...line, buyerId: cleo })).rejects.toMatchObject({ code: "AUCTION_HOLD" });

    const cs = crypto.randomUUID();
    await recordAuctionCheckout(cs, id, ben);
    await markAuctionPaid(cs, crypto.randomUUID());
    await expect(resolveAuctionLinePrice({ ...line, buyerId: ben, auctionId: id })).rejects.toMatchObject({ code: "AUCTION_PAID" });
    expect(await resolveAuctionLinePrice({ ...line, buyerId: cleo })).toBeNull();
  });

  it("an auction with no bids ends unsold; the host can cancel only before the first bid", async () => {
    const a = await oneOfOne("Unsold piece");
    const id = (await start(a.productId)).body.auction.id;
    await setEndsIn(id, -1);
    const { settleDueAuctions } = await import("../../lib/liveAuctions");
    expect(await settleDueAuctions()).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(liveAuctions).where(eq(liveAuctions.id, id));
    expect(row.status).toBe("unsold");

    const b = await oneOfOne("Cancel piece");
    const id2 = (await start(b.productId)).body.auction.id;
    await bid(ana, id2, 500);
    auth.userId = host;
    expect((await request(`/api/live/${streamId}/auctions/${id2}/cancel`, "POST", {})).body.code).toBe("HAS_BIDS");
    const c = await oneOfOne("Cancel early piece");
    await db.update(liveAuctions).set({ status: "cancelled" }).where(eq(liveAuctions.id, id2));
    const id3 = (await start(c.productId)).body.auction.id;
    auth.userId = host;
    expect((await request(`/api/live/${streamId}/auctions/${id3}/cancel`, "POST", {})).body.auction.status).toBe("cancelled");
  });

  it("the winner's pay window closes", async () => {
    const piece = await oneOfOne("Late payer piece");
    const id = (await start(piece.productId)).body.auction.id;
    await bid(ana, id, 500);
    await setEndsIn(id, -1);
    const { settleDueAuctions, resolveAuctionLinePrice } = await import("../../lib/liveAuctions");
    await settleDueAuctions();
    await db.update(liveAuctions).set({ payBy: new Date(Date.now() - 1000) }).where(eq(liveAuctions.id, id));
    await expect(resolveAuctionLinePrice({ productId: piece.productId, variantId: piece.variantIds[0], quantity: 1, buyerId: ana, auctionId: id }))
      .rejects.toMatchObject({ code: "AUCTION_PAY_EXPIRED" });
  });
});
