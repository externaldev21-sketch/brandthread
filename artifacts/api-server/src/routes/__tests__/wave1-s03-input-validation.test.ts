/**
 * Wave 1 / slice s03: malformed ids and cursors must be answered as 4xx, not
 * reach a uuid / bigint cast in Postgres and come back as a 500, and the
 * communities admin gate must stop the handler after its 403.
 *
 * Real Postgres + the real routers; only auth (a header) and the realtime /
 * push edges are stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, communities, communityMembers, conversationParticipants, conversations, follows, messages, savedCollections,
} from "@workspace/db";

vi.mock("../../middlewares/requireAuth", async (orig) => ({
  ...(await orig<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
}));
vi.mock("../../lib/push", async (orig) => ({
  ...(await orig<typeof import("../../lib/push")>()),
  sendPushToUser: async () => true,
}));
vi.mock("../../lib/voipPush", async (orig) => ({
  ...(await orig<typeof import("../../lib/voipPush")>()),
  sendCallVoipPush: async () => ({ apns: 0, fcm: 0, removed: 0 }),
}));
vi.mock("../../ws/callHub", () => ({ sendCallEvent: () => 0 }));

const tag = crypto.randomBytes(5).toString("hex");
const ALICE = `w1s03-alice-${tag}`;
const BOB = `w1s03-bob-${tag}`;
const CARA = `w1s03-cara-${tag}`;
const NOT_UUID = "not-a-uuid";
const DASHES = "-".repeat(36);

let server: Server;
let base = "";
const routeErrors: unknown[] = [];
const createdConversations: string[] = [];
const createdCommunities: string[] = [];

function as(user: string, path: string, method = "GET", body?: unknown) {
  return fetch(`${base}/api${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-acting-as": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function makeConversation(): Promise<string> {
  const [conv] = await db.insert(conversations).values({ type: "buyer_to_buyer" }).returning({ id: conversations.id });
  await db.insert(conversationParticipants).values([
    { conversationId: conv!.id, userId: ALICE, name: "Alice" },
    { conversationId: conv!.id, userId: BOB, name: "Bob" },
  ]);
  createdConversations.push(conv!.id);
  return conv!.id;
}

beforeAll(async () => {
  const [{ default: callRouter }, { default: closetRouter }, { default: collectionsRouter },
    { default: communitiesRouter }, { default: conversationsRouter }, { default: dataExportJobsRouter }] = await Promise.all([
    import("../call"), import("../closet"), import("../collections"),
    import("../communities"), import("../conversations"), import("../data-export-jobs"),
  ]);
  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined };
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/call", callRouter);
  app.use("/api/buyer/closet", closetRouter);
  app.use("/api/buyer/collections", collectionsRouter);
  app.use("/api/communities", communitiesRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/auth/data-export", dataExportJobsRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    routeErrors.push(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "unhandled" });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { routeErrors.length = 0; });

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdConversations.length) await db.delete(conversations).where(inArray(conversations.id, createdConversations));
  const groups = await db.select({ id: conversationParticipants.conversationId }).from(conversationParticipants)
    .where(inArray(conversationParticipants.userId, [ALICE, BOB, CARA]));
  if (groups.length) await db.delete(conversations).where(inArray(conversations.id, groups.map((g) => g.id)));
  if (createdCommunities.length) await db.delete(communities).where(inArray(communities.id, createdCommunities));
  await db.delete(savedCollections).where(inArray(savedCollections.userId, [ALICE, BOB]));
  await db.delete(follows).where(inArray(follows.followerId, [ALICE, BOB]));
});

describe("call tokens and events: a non-uuid thread id is not a participant (was 500)", () => {
  it("POST /token", async () => {
    const res = await as(ALICE, "/call/token", "POST", { conversationId: NOT_UUID, mode: "voice" });
    expect(res.status, await res.text()).toBe(403);
    expect(routeErrors).toEqual([]);
  });
  it("POST /token rejects a non-string id", async () => {
    const res = await as(ALICE, "/call/token", "POST", { conversationId: 12345, mode: "voice" });
    expect(res.status).toBe(400);
  });
  it("POST /token/renew", async () => {
    const res = await as(ALICE, "/call/token/renew", "POST", { threadId: NOT_UUID, mode: "voice", clientRenewalId: "renewal-12345" });
    expect(res.status, await res.text()).toBe(403);
    expect(routeErrors).toEqual([]);
  });
  it("POST /events", async () => {
    const res = await as(ALICE, "/call/events", "POST", { threadId: NOT_UUID, type: "started", mode: "voice", clientEventId: "event-12345" });
    expect(res.status, await res.text()).toBe(403);
    expect(routeErrors).toEqual([]);
  });
});

describe("closet: only real uuids reach the database", () => {
  it("DELETE /outfits/:id with a 36-dash id is 404", async () => {
    const res = await as(ALICE, `/buyer/closet/outfits/${DASHES}`, "DELETE");
    expect(res.status, await res.text()).toBe(404);
  });
  it("POST /outfits with a 36-dash piece id is 400", async () => {
    const res = await as(ALICE, "/buyer/closet/outfits", "POST", { pieceIds: [DASHES] });
    expect(res.status, await res.text()).toBe(400);
  });
});

describe("collections: non-uuid ids", () => {
  it("GET /:id/items and PATCH /:id are 404, DELETE /:id is a no-op", async () => {
    expect((await as(ALICE, `/buyer/collections/${NOT_UUID}/items`)).status).toBe(404);
    expect((await as(ALICE, `/buyer/collections/${NOT_UUID}`, "PATCH", { name: "x" })).status).toBe(404);
    const del = await as(ALICE, `/buyer/collections/${NOT_UUID}`, "DELETE");
    expect(del.status).toBe(200);
    expect(routeErrors).toEqual([]);
  });
  it("POST /reorder skips an id that isn't a uuid and keeps the others' positions", async () => {
    const created = await as(ALICE, "/buyer/collections", "POST", { name: "Board" });
    expect(created.status).toBe(201);
    const board = await created.json() as { id: string };
    const res = await as(ALICE, "/buyer/collections/reorder", "POST", { orderedIds: [NOT_UUID, board.id] });
    expect(res.status, await res.text()).toBe(200);
    const [row] = await db.select({ sortOrder: savedCollections.sortOrder }).from(savedCollections).where(eq(savedCollections.id, board.id));
    expect(row?.sortOrder).toBe(1);
  });
});

describe("communities", () => {
  let communityId = "";
  beforeAll(async () => {
    const [c] = await db.insert(communities).values({
      name: `W1 S03 ${tag}`, slug: `w1-s03-${tag}`, description: "", kind: "user", visibility: "public",
      requireApproval: false, ownerId: ALICE, inviteCode: `w1s03${tag}`.slice(0, 12), memberCount: 2,
    }).returning();
    communityId = c!.id;
    createdCommunities.push(communityId);
    await db.insert(communityMembers).values([
      { communityId, userId: ALICE, role: "owner", lastReadSeq: 0 },
      { communityId, userId: BOB, role: "member", lastReadSeq: 0 },
    ]);
  });

  it("a plain member's admin action ends at the 403 (the handler no longer runs on)", async () => {
    for (const [method, path, body] of [
      ["PATCH", `/communities/${communityId}`, { description: "hijack" }],
      ["POST", `/communities/${communityId}/invite/reset`, {}],
      ["DELETE", `/communities/${communityId}/members/${ALICE}`, undefined],
      ["GET", `/communities/${communityId}/requests`, undefined],
    ] as const) {
      const res = await as(BOB, path, method, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(routeErrors).toEqual([]);
    const [c] = await db.select({ description: communities.description }).from(communities).where(eq(communities.id, communityId));
    expect(c?.description).toBe("");
  });

  it("GET /:id/messages with a fractional or unsafe cursor is 400 (was 500)", async () => {
    expect((await as(BOB, `/communities/${communityId}/messages?before=1.5`)).status).toBe(400);
    expect((await as(BOB, `/communities/${communityId}/messages?after=1e300`)).status).toBe(400);
    expect((await as(BOB, `/communities/${communityId}/messages?before=3`)).status).toBe(200);
    expect(routeErrors).toEqual([]);
  });

  it("PATCH /:id/read with a fractional seq falls back to the head (was 500)", async () => {
    const res = await as(BOB, `/communities/${communityId}/read`, "PATCH", { seq: 1.5 });
    expect(res.status, await res.text()).toBe(200);
    expect(routeErrors).toEqual([]);
  });
});

describe("conversations", () => {
  let convId = "";
  beforeAll(async () => { convId = await makeConversation(); });

  it("GET /:id/messages clamps a bad limit and rejects a bad `before` (was 500)", async () => {
    expect((await as(ALICE, `/conversations/${convId}/messages?limit=abc`)).status).toBe(200);
    expect((await as(ALICE, `/conversations/${convId}/messages?limit=-5`)).status).toBe(200);
    const bad = await as(ALICE, `/conversations/${convId}/messages?before=not-a-date`);
    expect(bad.status).toBe(400);
    expect(routeErrors).toEqual([]);
  });

  it("POST /:id/messages drops a non-uuid replyToId instead of failing the send", async () => {
    const res = await as(ALICE, `/conversations/${convId}/messages`, "POST", { text: "hello", replyToId: NOT_UUID });
    expect(res.status, await res.text()).toBe(201);
    expect(routeErrors).toEqual([]);
  });

  it("POST /:id/messages: a product / order / post card with a non-uuid id is 400", async () => {
    for (const attachment of [
      { type: "product", title: "P", meta: { productId: NOT_UUID } },
      { type: "order", title: "O", meta: { orderId: NOT_UUID } },
      { type: "post", title: "Q", meta: { postId: NOT_UUID } },
    ]) {
      const res = await as(ALICE, `/conversations/${convId}/messages`, "POST", { text: "", attachment });
      expect(res.status, `${attachment.type}: ${await res.text()}`).toBe(400);
    }
    expect(routeErrors).toEqual([]);
  });

  it("reactions on a non-uuid message id are 404", async () => {
    expect((await as(ALICE, `/conversations/${convId}/messages/${NOT_UUID}/reactions`, "PUT", { reactionType: "like" })).status).toBe(404);
    expect((await as(ALICE, `/conversations/${convId}/messages/${NOT_UUID}/reactions`, "DELETE")).status).toBe(404);
    expect(routeErrors).toEqual([]);
  });

  it("a 1:1 with yourself is 400 and creates nothing", async () => {
    const before = await db.select({ id: conversationParticipants.conversationId }).from(conversationParticipants)
      .where(eq(conversationParticipants.userId, CARA));
    const res = await as(CARA, "/conversations", "POST", {
      type: "buyer_to_buyer", participant: { userId: CARA, name: "Cara", handle: "", initials: "C", color: "#000", accountType: "buyer" },
    });
    expect(res.status, await res.text()).toBe(400);
    const after = await db.select({ id: conversationParticipants.conversationId }).from(conversationParticipants)
      .where(eq(conversationParticipants.userId, CARA));
    expect(after.length).toBe(before.length);
    expect(routeErrors).toEqual([]);
  });

  it("a group create de-duplicates invitees and leaves the creator out of the invitee list", async () => {
    // "Who can add you to groups" defaults to people they follow.
    await db.insert(follows).values([{ followerId: ALICE, followingId: CARA }, { followerId: BOB, followingId: CARA }]).onConflictDoNothing();
    const p = (userId: string) => ({ userId, name: userId, handle: "", initials: "X", color: "#000", accountType: "buyer" });
    const res = await as(CARA, "/conversations", "POST", { type: "group", participants: [p(ALICE), p(BOB), p(BOB), p(CARA)] });
    const body = await res.json() as { id: string; participants: Array<{ userId: string }> };
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.participants.map((x) => x.userId).sort()).toEqual([ALICE, BOB, CARA].sort());

    const tooFew = await as(CARA, "/conversations", "POST", { type: "group", participants: [p(ALICE), p(ALICE)] });
    expect(tooFew.status).toBe(400);
    expect(routeErrors).toEqual([]);
  });

  it("the sent message is stored without a reply link", async () => {
    const rows = await db.select({ replyToId: messages.replyToId }).from(messages).where(eq(messages.conversationId, convId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.replyToId === null)).toBe(true);
  });
});

describe("data export jobs", () => {
  it("POST /jobs/:id/link with a non-uuid id is 404 (was 500)", async () => {
    const res = await as(ALICE, `/auth/data-export/jobs/${NOT_UUID}/link`, "POST", {});
    expect(res.status, await res.text()).toBe(404);
  });
});
