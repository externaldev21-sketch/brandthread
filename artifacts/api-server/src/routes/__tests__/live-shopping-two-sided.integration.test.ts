/**
 * Live shopping, seller ↔ buyer, end to end: the real live router, the real
 * `ws` hub on the same HTTP server, real Postgres. Only Clerk (a header for
 * HTTP, the token-as-user-id for the socket) and the Pro-plan gate are
 * stubbed. Asserts what the OTHER side sees for every step:
 *
 *   seller goes live → followers get "<Brand> is live" (Activity + push)
 *   tags are priced from the catalogue, never the request
 *   buyer joins / chats / hearts → host socket receives it
 *   blocked viewer can't join, chat or open a socket
 *   host restarts after a crash → old live ends, its viewers are told
 *   host ends → viewers get { type: "ended" }; chat/heartbeat then refused
 *   a silent host's live is swept
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import WS from "ws";
import {
  blocks, db, follows, liveComments, liveStreams, liveViewers, notificationsFeed, products, productVariants, users,
} from "@workspace/db";

vi.hoisted(() => { process.env.AGORA_APP_ID ??= "test-agora-app"; });

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.headers["x-test-acting-as"];
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../ws/auth", () => ({
  verifyWsToken: async (token: string | undefined | null) => (token ? token : null),
}));

const sfx = `${process.pid}-${crypto.randomUUID().slice(0, 6)}`;
const SELLER = `live2s-seller-${sfx}`;
const OTHER_SELLER = `live2s-other-${sfx}`;
const FOLLOWER = `live2s-follower-${sfx}`;
const BLOCKED = `live2s-blocked-${sfx}`;
const ALL = [SELLER, OTHER_SELLER, FOLLOWER, BLOCKED];

let server: Server;
let base = "";
let wsBase = "";
let ownProductId = "";
let foreignProductId = "";
let endStaleLiveStreams: typeof import("../../jobs/liveStaleStreams").endStaleLiveStreams;

function as(userId: string, path: string, body?: unknown, method = "POST") {
  return fetch(`${base}/api/live${path}`, {
    method,
    headers: { "x-test-acting-as": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) as any }));
}

/** Opens a socket and records every event it receives. */
function socketFor(streamId: string, userId: string, host = false): Promise<{ ws: WS; events: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WS(`${wsBase}/ws/live?streamId=${streamId}&token=${userId}${host ? "&role=host" : ""}`);
    const events: any[] = [];
    ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
    ws.once("open", () => resolve({ ws, events }));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`ws ${res.statusCode}`)));
  });
}

async function waitForEvent(events: any[], match: (e: any) => boolean, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = events.find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no matching event; got ${JSON.stringify(events)}`);
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@t.test`, name: "Seller", brandName: "Atelier Nine", accountType: "seller", onboardingComplete: true },
    { clerkId: OTHER_SELLER, email: `${OTHER_SELLER}@t.test`, name: "Other", accountType: "seller", onboardingComplete: true },
    { clerkId: FOLLOWER, email: `${FOLLOWER}@t.test`, name: "Follower", displayName: "Fola", accountType: "buyer", onboardingComplete: true },
    { clerkId: BLOCKED, email: `${BLOCKED}@t.test`, name: "Blocked", accountType: "buyer", onboardingComplete: true },
  ]);
  await db.insert(follows).values([
    { followerId: FOLLOWER, followingId: SELLER },
    { followerId: BLOCKED, followingId: SELLER },
  ]);
  await db.insert(blocks).values({ blockerId: SELLER, blockedId: BLOCKED });
  const [own] = await db.insert(products).values({ ownerId: SELLER, name: "Wool Overshirt", status: "active", images: ["https://img.test/a.jpg"] }).returning({ id: products.id });
  const [foreign] = await db.insert(products).values({ ownerId: OTHER_SELLER, name: "Not yours", status: "active" }).returning({ id: products.id });
  ownProductId = own.id;
  foreignProductId = foreign.id;
  await db.insert(productVariants).values([
    { productId: own.id, sku: `l2s-a-${sfx}`, priceCents: 12800, stock: 0 },
    { productId: own.id, sku: `l2s-b-${sfx}`, priceCents: 14500, stock: 4 },
    { productId: foreign.id, sku: `l2s-c-${sfx}`, priceCents: 100, stock: 4 },
  ] as any);

  const { attachLiveWebSocket } = await import("../../ws/liveHub");
  ({ endStaleLiveStreams } = await import("../../jobs/liveStaleStreams"));
  const { default: liveRouter } = await import("../live");
  const app = express();
  app.use(express.json());
  app.use("/api/live", liveRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
  attachLiveWebSocket(server);
});

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  const streams = await db.select({ id: liveStreams.id }).from(liveStreams).where(inArray(liveStreams.sellerId, ALL));
  for (const s of streams) {
    await db.delete(liveViewers).where(eq(liveViewers.streamId, s.id));
    await db.delete(liveComments).where(eq(liveComments.streamId, s.id));
  }
  await db.delete(liveStreams).where(inArray(liveStreams.sellerId, ALL));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL));
  await db.delete(productVariants).where(inArray(productVariants.productId, [ownProductId, foreignProductId]));
  await db.delete(products).where(inArray(products.ownerId, ALL));
  await db.delete(blocks).where(inArray(blocks.blockerId, ALL));
  await db.delete(follows).where(inArray(follows.followerId, ALL));
  await db.delete(users).where(inArray(users.clerkId, ALL));
});

describe("Live shopping — seller ↔ buyer", () => {
  let streamId = "";

  it("seller goes live: tags are priced from the catalogue and followers are notified", async () => {
    const start = await as(SELLER, "/start", {
      title: "Fall drop",
      productTags: [
        { productId: ownProductId, productName: "Spoofed", priceCents: 1, highlighted: true },
        { productId: foreignProductId },
        { productId: "not-a-real-id" },
      ],
    });
    expect(start.status).toBe(201);
    streamId = start.body.stream.id;
    // Cheapest IN-STOCK variant ($145), not the sold-out $128 one or the request's $0.01.
    expect(start.body.stream.productTags).toEqual([{
      productId: ownProductId, productName: "Wool Overshirt", priceCents: 14500,
      imageUrl: "https://img.test/a.jpg", inStock: true, highlighted: true,
    }]);

    await vi.waitFor(async () => {
      const rows = await db.select().from(notificationsFeed)
        .where(inArray(notificationsFeed.userId, [FOLLOWER, BLOCKED]));
      const forFollower = rows.filter((r) => r.userId === FOLLOWER);
      expect(forFollower).toHaveLength(1);
      expect(forFollower[0]).toMatchObject({ type: "live_started", targetType: "live_stream", targetId: streamId, title: "Atelier Nine is live" });
      // A follower the seller blocked is never told.
      expect(rows.filter((r) => r.userId === BLOCKED)).toHaveLength(0);
    });
  });

  it("buyer joins, chats and sends hearts — the host's socket sees each of them", async () => {
    const host = await socketFor(streamId, SELLER, true);
    try {
      expect((await as(FOLLOWER, `/${streamId}/join`)).status).toBe(200);
      const viewer = await socketFor(streamId, FOLLOWER);
      try {
        const comment = await as(FOLLOWER, `/${streamId}/comment`, { message: "Size guide?" });
        expect(comment.status).toBe(201);
        const seen = await waitForEvent(host.events, (e) => e.type === "comment");
        expect(seen.comment).toMatchObject({ user_id: FOLLOWER, message: "Size guide?", display_name: "Fola" });

        const like = await as(FOLLOWER, `/${streamId}/like`, { count: 3 });
        expect(like.body).toMatchObject({ likeCount: 3, accepted: 3 });
        expect(await waitForEvent(host.events, (e) => e.type === "likes")).toMatchObject({ likeCount: 3 });
        expect(await waitForEvent(viewer.events, (e) => e.type === "likes")).toMatchObject({ likeCount: 3 });

        // Re-tagging is priced server-side too and reaches the viewer.
        const retag = await as(SELLER, `/${streamId}/products`, { productTags: [{ productId: ownProductId }] }, "PATCH");
        expect(retag.status).toBe(200);
        const products = await waitForEvent(viewer.events, (e) => e.type === "products");
        expect(products.productTags[0]).toMatchObject({ priceCents: 14500, highlighted: false });
      } finally {
        viewer.ws.close();
      }
    } finally {
      host.ws.close();
    }
  });

  it("a viewer the seller blocked can't join, chat or open the room socket", async () => {
    expect((await as(BLOCKED, `/${streamId}/join`)).status).toBe(404);
    const chat = await as(BLOCKED, `/${streamId}/comment`, { message: "hi" });
    expect(chat.status).toBe(403);
    await expect(socketFor(streamId, BLOCKED)).rejects.toThrow(/403/);
    // Only the stream's own seller may connect as host.
    await expect(socketFor(streamId, FOLLOWER, true)).rejects.toThrow(/403/);
  });

  it("a chat line never reaches, in realtime, a viewer who blocked its author", async () => {
    await db.insert(blocks).values({ blockerId: FOLLOWER, blockedId: OTHER_SELLER });
    const host = await socketFor(streamId, SELLER, true);
    const follower = await socketFor(streamId, FOLLOWER);
    try {
      expect((await as(OTHER_SELLER, `/${streamId}/comment`, { message: "from someone you blocked" })).status).toBe(201);
      await waitForEvent(host.events, (e) => e.type === "comment" && e.comment.user_id === OTHER_SELLER);
      await new Promise((r) => setTimeout(r, 200));
      expect(follower.events.some((e) => e.type === "comment" && e.comment.user_id === OTHER_SELLER)).toBe(false);
    } finally {
      host.ws.close();
      follower.ws.close();
      await db.delete(blocks).where(eq(blocks.blockerId, FOLLOWER));
    }
  });

  it("a malformed stream id is a 404, not a 500", async () => {
    expect((await as(FOLLOWER, "/not-a-uuid/join")).status).toBe(404);
    expect((await as(FOLLOWER, "/not-a-uuid/comment", { message: "x" })).status).toBe(404);
  });

  it("host crashes and goes live again: the old live ends and its viewers are told", async () => {
    const viewer = await socketFor(streamId, FOLLOWER);
    try {
      const restart = await as(SELLER, "/start", { title: "Back again" });
      expect(restart.status).toBe(201);
      const ended = await waitForEvent(viewer.events, (e) => e.type === "ended");
      expect(ended.reason).toBe("restarted");
      const [old] = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId));
      expect(old.status).toBe("ended");
      streamId = restart.body.stream.id;
    } finally {
      viewer.ws.close();
    }
  });

  it("host ends: viewers get 'ended' right away; chat, hearts and heartbeats are then refused", async () => {
    await as(FOLLOWER, `/${streamId}/join`);
    const viewer = await socketFor(streamId, FOLLOWER);
    try {
      const end = await as(SELLER, `/${streamId}/end`);
      expect(end.status).toBe(200);
      const ended = await waitForEvent(viewer.events, (e) => e.type === "ended");
      expect(ended).toMatchObject({ reason: "host", replayStatus: "unavailable" });
    } finally {
      viewer.ws.close();
    }
    expect((await as(FOLLOWER, `/${streamId}/comment`, { message: "late" })).status).toBe(410);
    expect((await as(FOLLOWER, `/${streamId}/like`, {})).status).toBe(410);
    expect((await as(FOLLOWER, `/${streamId}/heartbeat`)).status).toBe(410);
    expect((await as(SELLER, `/${streamId}/products`, { productTags: [] }, "PATCH")).status).toBe(410);
    const viewers = await db.select().from(liveViewers).where(eq(liveViewers.streamId, streamId));
    expect(viewers).toHaveLength(0);
  });

  it("a live whose host went silent is swept, so it leaves buyers' feeds", async () => {
    const start = await as(SELLER, "/start", { title: "Will crash" });
    const crashed = start.body.stream.id as string;
    await db.execute(sql`UPDATE live_streams SET host_last_seen_at = now() - interval '6 minutes' WHERE id = ${crashed}::uuid`);
    // A healthy live from another seller is untouched.
    const healthy = await as(OTHER_SELLER, "/start", { title: "Healthy" });

    await endStaleLiveStreams();
    const [row] = await db.select().from(liveStreams).where(eq(liveStreams.id, crashed));
    expect(row.status).toBe("ended");
    const [ok] = await db.select().from(liveStreams).where(eq(liveStreams.id, healthy.body.stream.id));
    expect(ok.status).toBe("live");
    const feed = await fetch(`${base}/api/live/feed`).then((r) => r.json()) as any;
    expect(feed.streams.map((s: any) => s.id)).not.toContain(crashed);
    await as(OTHER_SELLER, `/${healthy.body.stream.id}/end`);
  });
});
