/**
 * END-TO-END SOCIAL — buyer↔seller messaging, driven from BOTH sides through
 * the real routers + the real /ws/user socket against real Postgres. Every
 * assertion is on what the OTHER side sees:
 *   - a message / read receipt / typing reaches the other side as a realtime
 *     hint (no more 12–30s poll lag); the reader's "New message" Activity rows
 *     are read with the thread; message notifications carry the actor;
 *   - Archive and Delete are per-viewer (Delete used to wipe the thread for
 *     BOTH sides); a new message brings a deleted chat back with only new
 *     history; declining a request no longer erases the requester's copy;
 *   - inbox previews never show removed messages; a blocked 1:1 leaves the
 *     inbox; order cards only go to the other party on that order; public
 *     posts can be shared into friend DMs;
 *   - account Mute is server-side: DMs stop notifying, posts leave the feed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db, users, follows, posts, conversations, conversationParticipants, messages, notificationsFeed,
  orders, blocks, accountMutes,
} from "@workspace/db";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const S = `soc-msg-seller-${suffix}`;
const A = `soc-msg-buyer-a-${suffix}`;
const B = `soc-msg-buyer-b-${suffix}`;
const ALL = [S, A, B];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const header = req.header("x-test-user-id");
    if (!header) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = header;
    next();
  },
}));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: vi.fn(async () => {}) };
});

let server: Server;
let base = "";
let wsBase = "";
const sockets: WebSocket[] = [];

async function call(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A real /ws/user client for `userId`, collecting every event it receives. */
async function listen(userId: string): Promise<{ events: any[]; next: (pred: (e: any) => boolean, ms?: number) => Promise<any> }> {
  const ws = new WebSocket(`${wsBase}/ws/user?token=test:${userId}`);
  sockets.push(ws);
  const events: any[] = [];
  ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  await expect.poll(() => events.some((e) => e.type === "ready")).toBe(true);
  return {
    events,
    next: async (pred, ms = 3000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = events.find(pred);
        if (hit) { events.splice(events.indexOf(hit), 1); return hit; }
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`no matching realtime event for ${userId}; got ${JSON.stringify(events)}`);
    },
  };
}

async function startConversation(from: string, to: { userId: string; accountType: string }, type = "buyer_to_seller") {
  const res = await call("POST", "/api/conversations", from, {
    type,
    participant: { userId: to.userId, name: to.userId, handle: "", initials: "XX", color: "#333338", accountType: to.accountType },
    myInfo: { name: from, handle: "", initials: "ME", color: "#333338", accountType: from === S ? "seller" : "buyer" },
  });
  expect(res.status).toBeLessThan(300);
  return res.body.id as string;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: S, email: `${S}@example.test`, name: "Msg Seller", displayName: "Msg Seller", brandName: "Msg Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: A, email: `${A}@example.test`, name: "Msg Buyer A", displayName: "Msg Buyer A", accountType: "buyer", onboardingComplete: true },
    { clerkId: B, email: `${B}@example.test`, name: "Msg Buyer B", displayName: "Msg Buyer B", accountType: "buyer", onboardingComplete: true },
  ]);
  // S follows A and A↔B are mutual, so their chats land in the main inbox.
  await db.insert(follows).values([
    { followerId: S, followingId: A }, { followerId: A, followingId: S },
    { followerId: A, followingId: B }, { followerId: B, followingId: A },
  ]);

  const [{ default: conversationsRouter }, { default: socialRouter }, { default: mutesRouter }, { default: postsRouter }, { attachUserWebSocket }] =
    await Promise.all([import("../conversations"), import("../social"), import("../account-mutes"), import("../posts"), import("../../ws/userHub")]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/conversations", (req: any, res, next) => {
    const id = req.header("x-test-user-id");
    if (!id) { res.status(401).end(); return; }
    req.clerkUserId = id; next();
  }, conversationsRouter);
  app.use("/api/social/mutes", mutesRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/posts", postsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  attachUserWebSocket(server, { verifyToken: async (t) => (t?.startsWith("test:") ? t.slice(5) : null) });
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const ws of sockets) ws.close();
  const convIds = (await db.select({ id: conversationParticipants.conversationId }).from(conversationParticipants)
    .where(inArray(conversationParticipants.userId, ALL))).map((r) => r.id);
  if (convIds.length) await db.delete(conversations).where(inArray(conversations.id, convIds));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL));
  await db.delete(accountMutes).where(inArray(accountMutes.userId, ALL));
  await db.delete(orders).where(inArray(orders.ownerId, ALL));
  await db.delete(posts).where(inArray(posts.userId, ALL));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, ALL), inArray(blocks.blockedId, ALL)));
  await db.delete(follows).where(or(inArray(follows.followerId, ALL), inArray(follows.followingId, ALL)));
  await db.delete(users).where(inArray(users.clerkId, ALL));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("Realtime + read receipts", () => {
  it("a buyer's message reaches the seller live; the seller reading it reaches the buyer live; Activity rows clear with the thread", async () => {
    const sellerRt = await listen(S);
    const buyerRt = await listen(A);
    const convId = await startConversation(A, { userId: S, accountType: "seller" });

    expect((await call("POST", `/api/conversations/${convId}/messages`, A, { text: "Is the jacket lined?" })).status).toBe(201);
    await sellerRt.next((e) => e.type === "conversation.updated" && e.conversationId === convId && e.reason === "message");

    const inbox = await call("GET", "/api/conversations", S);
    expect(inbox.body.find((c: any) => c.id === convId)).toMatchObject({ unreadCount: 1, lastMessage: "Is the jacket lined?" });

    // The notification carries the actor (block filter + "see less" apply).
    await expect.poll(async () => (await db.select().from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, S), eq(notificationsFeed.targetId, convId)))).map((n) => n.actorId)).toEqual([A]);
    await sellerRt.next((e) => e.type === "activity.updated");

    // Typing reaches the buyer live too.
    await call("PATCH", `/api/conversations/${convId}/typing`, S, { typing: true });
    await buyerRt.next((e) => e.type === "conversation.updated" && e.reason === "typing");

    expect((await call("PATCH", `/api/conversations/${convId}/read`, S)).status).toBe(200);
    await buyerRt.next((e) => e.type === "conversation.updated" && e.conversationId === convId && e.reason === "read");
    const thread = await call("GET", `/api/conversations/${convId}/messages`, A);
    expect(thread.body.at(-1)).toMatchObject({ status: "read" });
    const feedRows = await db.select().from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, S), eq(notificationsFeed.targetId, convId)));
    expect(feedRows.every((r) => r.isRead)).toBe(true);
  });
});

describe("Per-viewer archive and delete", () => {
  it("archive is the archiver's only; delete-for-me keeps the other side's history; a new message brings it back with only new history", async () => {
    const convId = await startConversation(A, { userId: S, accountType: "seller" });
    await call("POST", `/api/conversations/${convId}/messages`, A, { text: "old message" });

    expect((await call("PATCH", `/api/conversations/${convId}/archive`, S, { archived: true })).body).toMatchObject({ isArchived: true });
    expect((await call("GET", "/api/conversations", S)).body.find((c: any) => c.id === convId).isArchived).toBe(true);
    expect((await call("GET", "/api/conversations", A)).body.find((c: any) => c.id === convId).isArchived).toBe(false);
    await call("PATCH", `/api/conversations/${convId}/archive`, S, { archived: false });

    expect((await call("DELETE", `/api/conversations/${convId}`, A)).status).toBe(200);
    expect((await call("GET", "/api/conversations", A)).body.some((c: any) => c.id === convId)).toBe(false);
    // The seller still has the whole thread.
    const sellerThread = await call("GET", `/api/conversations/${convId}/messages`, S);
    expect(sellerThread.body.map((m: any) => m.text ?? m.body)).toContain("old message");

    await call("POST", `/api/conversations/${convId}/messages`, S, { text: "still interested?" });
    const back = (await call("GET", "/api/conversations", A)).body.find((c: any) => c.id === convId);
    expect(back).toBeTruthy();
    const buyerThread = await call("GET", `/api/conversations/${convId}/messages`, A);
    const texts = buyerThread.body.map((m: any) => m.text ?? m.body);
    expect(texts).toContain("still interested?");
    expect(texts).not.toContain("old message");
  });

  it("declining a request removes it for the recipient only", async () => {
    // B doesn't follow / isn't followed by S and has no order → a request.
    const convId = await startConversation(B, { userId: S, accountType: "seller" });
    await call("POST", `/api/conversations/${convId}/messages`, B, { text: "hello?" });
    expect((await call("GET", "/api/conversations", S)).body.find((c: any) => c.id === convId)).toMatchObject({ isRequest: true });
    expect((await call("DELETE", `/api/conversations/${convId}`, S)).status).toBe(200);
    expect((await call("GET", "/api/conversations", S)).body.some((c: any) => c.id === convId)).toBe(false);
    expect((await call("GET", "/api/conversations", B)).body.some((c: any) => c.id === convId)).toBe(true);
  });
});

describe("Inbox hygiene", () => {
  it("previews skip moderator-removed messages; a blocked 1:1 leaves the inbox and comes back on unblock", async () => {
    const convId = await startConversation(A, { userId: B, accountType: "buyer" }, "buyer_to_buyer");
    await call("POST", `/api/conversations/${convId}/messages`, A, { text: "visible one" });
    const bad = await call("POST", `/api/conversations/${convId}/messages`, A, { text: "removed one" });
    await db.update(messages).set({ moderationStatus: "removed" }).where(eq(messages.id, bad.body.id));
    expect((await call("GET", "/api/conversations", B)).body.find((c: any) => c.id === convId).lastMessage).toBe("visible one");

    expect((await call("POST", "/api/social/block", B, { userId: A })).status).toBeLessThan(300);
    expect((await call("GET", "/api/conversations", B)).body.some((c: any) => c.id === convId)).toBe(false);
    expect((await call("GET", "/api/conversations", A)).body.some((c: any) => c.id === convId)).toBe(false);
    expect((await call("DELETE", `/api/social/block/${A}`, B)).status).toBeLessThan(300);
    expect((await call("GET", "/api/conversations", B)).body.some((c: any) => c.id === convId)).toBe(true);
  });
});

describe("Cards in chat", () => {
  it("an order card only goes to the other party on that order (seller→its buyer, buyer→its seller)", async () => {
    const [orderA] = await db.insert(orders).values({ ownerId: S, buyerId: A, orderNumber: `MSG-A-${suffix}`, totalCents: 1000, subtotalCents: 1000, paidAt: new Date() } as any).returning({ id: orders.id });
    const [orderB] = await db.insert(orders).values({ ownerId: S, buyerId: B, orderNumber: `MSG-B-${suffix}`, totalCents: 2000, subtotalCents: 2000, paidAt: new Date() } as any).returning({ id: orders.id });
    const convId = await startConversation(S, { userId: A, accountType: "buyer" }, "buyer_to_seller_order");
    const send = (from: string, orderId: string) => call("POST", `/api/conversations/${convId}/messages`, from, {
      text: "", attachment: { type: "order", title: "Order", meta: { orderId } },
    });
    expect((await send(S, orderB.id)).status).toBe(403); // B's order to A — would leak
    expect((await send(S, orderA.id)).status).toBe(201);
    expect((await send(A, orderA.id)).status).toBe(201); // buyer shares own order with its seller
  });

  it("a public post can be shared into a friend DM (used to 403)", async () => {
    const [post] = await db.insert(posts).values({ userId: S, mediaUrl: "https://example.test/share.jpg" }).returning({ id: posts.id });
    const convId = await startConversation(A, { userId: B, accountType: "buyer" }, "buyer_to_buyer");
    const res = await call("POST", `/api/conversations/${convId}/messages`, A, {
      text: "", attachment: { type: "post", title: "Post", meta: { postId: post.id } },
    });
    expect(res.status).toBe(201);
  });
});

describe("Account mute is server-side", () => {
  it("muting the seller stops their DM notifications and removes their posts from the Following feed; unmute restores", async () => {
    await db.insert(posts).values({ userId: S, mediaUrl: "https://example.test/muted-feed.jpg" });
    const feedHas = async () => ((await call("GET", "/api/posts/feed", A)).body as any[]).some((p) => p.userId === S);
    expect(await feedHas()).toBe(true);

    expect((await call("POST", "/api/social/mutes", A, { userId: S })).status).toBe(200);
    expect((await call("GET", "/api/social/mutes", A)).body.map((m: any) => m.mutedUserId)).toEqual([S]);
    expect(await feedHas()).toBe(false);

    const convId = await startConversation(A, { userId: S, accountType: "seller" });
    await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, A));
    await call("POST", `/api/conversations/${convId}/messages`, S, { text: "muted ping" });
    await new Promise((r) => setTimeout(r, 400));
    expect(await db.select().from(notificationsFeed).where(and(eq(notificationsFeed.userId, A), eq(notificationsFeed.targetId, convId)))).toHaveLength(0);
    // The message itself still arrives.
    expect((await call("GET", `/api/conversations/${convId}/messages`, A)).body.at(-1).text ?? "").toBeDefined();

    expect((await call("DELETE", `/api/social/mutes/${S}`, A)).status).toBe(200);
    expect(await feedHas()).toBe(true);
  });
});
