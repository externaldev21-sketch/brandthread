/**
 * Live realtime — WebSocket auth/room-broadcast + presence viewer-count math.
 *
 * Real Express router (the exact live.ts route mounts), a real `http.Server`
 * with the real `ws` WebSocketServer attached via attachLiveWebSocket (see
 * ws/liveHub.ts), a real `ws` client connecting over that same port, and a
 * real local Postgres for `live_streams` / `live_comments` / `live_viewers`.
 *
 * `requireAuth` is stubbed to read identity off a header, and the WebSocket
 * upgrade's `verifyWsToken` is stubbed to treat the token as the user id
 * directly — the same substitution this repo's other e2e tests use for
 * Clerk (see conversation-two-account-e2e.test.ts's header stub), because
 * this sandbox has no network egress to Clerk. Every other layer (Express,
 * the raw `ws` upgrade handshake, Drizzle, Postgres) is the real thing.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, users, liveStreams, liveComments, liveViewers } from "@workspace/db";
import { sql } from "drizzle-orm";
import WS from "ws";

const SELLER = `e2e-live-seller-${process.pid}`;
const VIEWER_A = `e2e-live-viewer-a-${process.pid}`;
const VIEWER_B = `e2e-live-viewer-b-${process.pid}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));
// Hosting is plan-gated (live_hosting); these tests are about realtime, not plans.
vi.mock("../../middlewares/featureGate", () => ({
  featureGate: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../ws/auth", () => ({
  // Test stand-in for Clerk's verifyToken: the token *is* the user id.
  verifyWsToken: async (token: string | undefined | null) => (token ? token : null),
}));

async function cleanup() {
  const streams = await db.select({ id: liveStreams.id }).from(liveStreams).where(eq(liveStreams.sellerId, SELLER));
  for (const s of streams) {
    await db.delete(liveViewers).where(eq(liveViewers.streamId, s.id));
    await db.delete(liveComments).where(eq(liveComments.streamId, s.id));
  }
  await db.delete(liveStreams).where(eq(liveStreams.sellerId, SELLER));
  await db.delete(users).where(eq(users.clerkId, SELLER));
  await db.delete(users).where(eq(users.clerkId, VIEWER_A));
  await db.delete(users).where(eq(users.clerkId, VIEWER_B));
}

let server: Server;
let baseUrl = "";
let wsBaseUrl = "";
let attachLiveWebSocket: typeof import("../../ws/liveHub").attachLiveWebSocket;
let recomputeLiveViewerCounts: typeof import("../../jobs/liveViewersPresence").recomputeLiveViewerCounts;

function asUser(userId: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, "x-test-acting-as": userId, "Content-Type": "application/json" },
  });
}

async function createStream(): Promise<string> {
  const [row] = await db.insert(liveStreams).values({
    sellerId: SELLER,
    channelName: `e2e_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: "E2E live realtime test",
    status: "live",
  }).returning({ id: liveStreams.id });
  return row.id;
}

function connectWs(streamId: string, token: string): Promise<WS> {
  return new Promise((resolve, reject) => {
    const socket = new WS(`${wsBaseUrl}/ws/live?streamId=${encodeURIComponent(streamId)}&token=${encodeURIComponent(token)}`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket: WS): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a WebSocket message")), 5000);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

describe("Live realtime: WebSocket auth/broadcast + presence viewer counts", () => {
  beforeEach(async () => {
    await cleanup();
    await db.insert(users).values([
      { clerkId: SELLER, email: `${SELLER}@example.test`, name: "E2E Seller", displayName: "E2E Seller", accountType: "seller", onboardingComplete: true },
      { clerkId: VIEWER_A, email: `${VIEWER_A}@example.test`, name: "E2E Viewer A", displayName: "E2E Viewer A", accountType: "buyer", onboardingComplete: true },
      { clerkId: VIEWER_B, email: `${VIEWER_B}@example.test`, name: "E2E Viewer B", displayName: "E2E Viewer B", accountType: "buyer", onboardingComplete: true },
    ]);

    if (!server) {
      ({ attachLiveWebSocket } = await import("../../ws/liveHub"));
      ({ recomputeLiveViewerCounts } = await import("../../jobs/liveViewersPresence"));
      const { default: liveRouter } = await import("../live");
      const app = express();
      app.use(express.json());
      app.use("/api/live", liveRouter);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      wsBaseUrl = `ws://127.0.0.1:${port}`;
      attachLiveWebSocket(server);
    }
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("presence: join, heartbeat, stale-expiry, and peak tracking compute the right viewer_count", async () => {
    const streamId = await createStream();

    // Join as two viewers — each POST /:id/join upserts its own live_viewers row.
    await asUser(VIEWER_A, `/api/live/${streamId}/join`, { method: "POST" });
    await asUser(VIEWER_B, `/api/live/${streamId}/join`, { method: "POST" });

    await recomputeLiveViewerCounts();
    let [stream] = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId));
    expect(stream.viewerCount).toBe(2);
    expect(stream.peakViewerCount).toBe(2);

    // Viewer B leaves explicitly (DELETE its row) — count drops, peak holds.
    await asUser(VIEWER_B, `/api/live/${streamId}/leave`, { method: "POST" });
    await recomputeLiveViewerCounts();
    [stream] = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId));
    expect(stream.viewerCount).toBe(1);
    expect(stream.peakViewerCount).toBe(2); // running max, never decreases

    // Viewer A's heartbeat (HTTP fallback route) refreshes last_seen.
    const heartbeatRes = await asUser(VIEWER_A, `/api/live/${streamId}/heartbeat`, { method: "POST" });
    expect(heartbeatRes.status).toBe(200);
    await recomputeLiveViewerCounts();
    [stream] = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId));
    expect(stream.viewerCount).toBe(1);

    // Simulate viewer A going stale (no heartbeat for > 45s) by backdating
    // its row directly, then recompute: count must fall to 0, peak still 2.
    await db.execute(sql`
      UPDATE live_viewers SET last_seen = now() - interval '60 seconds'
      WHERE stream_id = ${streamId}::uuid AND user_id_or_session_id = ${VIEWER_A}
    `);
    await recomputeLiveViewerCounts();
    [stream] = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId));
    expect(stream.viewerCount).toBe(0);
    expect(stream.peakViewerCount).toBe(2);
  });

  it("rejects a WebSocket upgrade with no/invalid auth token", async () => {
    const streamId = await createStream();
    const socket = new WS(`${wsBaseUrl}/ws/live?streamId=${encodeURIComponent(streamId)}`); // no token
    const closed = await new Promise<{ code: number }>((resolve) => {
      socket.once("close", (code) => resolve({ code }));
      socket.once("unexpected-response", (_req, res) => resolve({ code: res.statusCode ?? 0 }));
    });
    expect(closed.code === 1006 || closed.code === 401 || closed.code === 0).toBeTruthy();
  });

  it("authenticated WebSocket joins the stream's room and receives a broadcast comment", async () => {
    const streamId = await createStream();
    const socket = await connectWs(streamId, VIEWER_A);
    try {
      const incoming = nextMessage(socket);
      const commentRes = await asUser(VIEWER_A, `/api/live/${streamId}/comment`, {
        method: "POST",
        body: JSON.stringify({ message: "hello from the e2e test" }),
      });
      expect(commentRes.status).toBe(201);
      const event = await incoming;
      expect(event.type).toBe("comment");
      expect(event.comment.message).toBe("hello from the e2e test");
    } finally {
      socket.close();
    }
  });

  it("broadcasts a product-tag update to every socket in the room", async () => {
    const streamId = await createStream();
    const socketA = await connectWs(streamId, VIEWER_A);
    const socketB = await connectWs(streamId, VIEWER_B);
    try {
      const incomingA = nextMessage(socketA);
      const incomingB = nextMessage(socketB);
      const tags = [{ productId: "p1", productName: "Test Product", priceCents: 1999 }];
      const patchRes = await asUser(SELLER, `/api/live/${streamId}/products`, {
        method: "PATCH",
        body: JSON.stringify({ productTags: tags }),
      });
      expect(patchRes.status).toBe(200);
      const [eventA, eventB] = await Promise.all([incomingA, incomingB]);
      expect(eventA.type).toBe("products");
      expect(eventA.productTags).toEqual(tags);
      expect(eventB.type).toBe("products");
      expect(eventB.productTags).toEqual(tags);
    } finally {
      socketA.close();
      socketB.close();
    }
  });

  it("a WebSocket connection's viewer row disappears from live_viewers on close", async () => {
    const streamId = await createStream();
    const socket = await connectWs(streamId, VIEWER_A);
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the connect-time upsert land
    let rows = await db.select().from(liveViewers)
      .where(eq(liveViewers.streamId, streamId));
    expect(rows.some((r) => r.userIdOrSessionId === VIEWER_A)).toBe(true);

    await new Promise<void>((resolve) => { socket.once("close", () => resolve()); socket.close(); });
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the close-time delete land

    rows = await db.select().from(liveViewers).where(eq(liveViewers.streamId, streamId));
    expect(rows.some((r) => r.userIdOrSessionId === VIEWER_A)).toBe(false);
  });
});
