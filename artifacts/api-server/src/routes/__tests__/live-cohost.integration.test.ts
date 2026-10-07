/**
 * Live co-host, host ↔ invitee ↔ viewers, end to end: the real live +
 * live-cohost routers, the real `ws` hub on the same HTTP server, real
 * Postgres. Only Clerk (a header for HTTP, the token-as-user-id for the
 * socket) and the Pro-plan gate are stubbed.
 *
 *   host finds sellers (blocked / buyers / self excluded) and invites one →
 *   invitee gets an Activity invite (deep link target live_cohost) →
 *   accept returns an Agora PUBLISHER token with its own uid → every socket
 *   in the room gets the co-host list → the co-host may hold a host socket →
 *   max open co-hosts → host cancels / removes, co-host leaves →
 *   a block placed after the invite stops the accept → ending the live ends
 *   every co-host.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray, sql } from "drizzle-orm";
import WS from "ws";
import {
  blocks, db, follows, liveCohosts, liveComments, liveStreams, liveViewers, notificationsFeed, users,
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
const HOST = `cohost-host-${sfx}`;
const CO1 = `cohost-a-${sfx}`;
const CO2 = `cohost-b-${sfx}`;
const CO3 = `cohost-c-${sfx}`;
const CO4 = `cohost-d-${sfx}`;
const BLOCKED_SELLER = `cohost-blocked-${sfx}`;
const BUYER = `cohost-buyer-${sfx}`;
const ALL = [HOST, CO1, CO2, CO3, CO4, BLOCKED_SELLER, BUYER];

let server: Server;
let base = "";
let wsBase = "";

function as(userId: string, path: string, body?: unknown, method = "POST") {
  return fetch(`${base}/api/live${path}`, {
    method,
    headers: { "x-test-acting-as": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) as any }));
}

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
    { clerkId: HOST, email: `${HOST}@t.test`, name: "Host", brandName: "Atelier Nine", accountType: "seller", onboardingComplete: true },
    { clerkId: CO1, email: `${CO1}@t.test`, name: "Co One", brandName: "Rue Studio", accountType: "seller", onboardingComplete: true },
    { clerkId: CO2, email: `${CO2}@t.test`, name: "Co Two", brandName: "Loom & Line", accountType: "both", onboardingComplete: true },
    { clerkId: CO3, email: `${CO3}@t.test`, name: "Co Three", brandName: "Stonewashed", accountType: "seller", onboardingComplete: true },
    { clerkId: CO4, email: `${CO4}@t.test`, name: "Co Four", brandName: "North Knit", accountType: "seller", onboardingComplete: true },
    { clerkId: BLOCKED_SELLER, email: `${BLOCKED_SELLER}@t.test`, name: "Blocked", brandName: "Blocked Co", accountType: "seller", onboardingComplete: true },
    { clerkId: BUYER, email: `${BUYER}@t.test`, name: "Buyer", accountType: "buyer", onboardingComplete: true },
  ]);
  await db.insert(follows).values({ followerId: HOST, followingId: CO1 });
  await db.insert(blocks).values({ blockerId: BLOCKED_SELLER, blockedId: HOST });

  const { attachLiveWebSocket } = await import("../../ws/liveHub");
  const { default: liveRouter } = await import("../live");
  const { default: liveCohostRouter } = await import("../live-cohost");
  const app = express();
  app.use(express.json());
  app.use("/api/live", liveCohostRouter);
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
    await db.delete(liveCohosts).where(eq(liveCohosts.streamId, s.id));
    await db.delete(liveViewers).where(eq(liveViewers.streamId, s.id));
    await db.delete(liveComments).where(eq(liveComments.streamId, s.id));
  }
  await db.delete(liveStreams).where(inArray(liveStreams.sellerId, ALL));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL));
  await db.delete(blocks).where(inArray(blocks.blockerId, ALL));
  await db.delete(follows).where(inArray(follows.followerId, ALL));
  await db.delete(users).where(inArray(users.clerkId, ALL));
});

describe("Live co-host — host ↔ invitee ↔ viewers", () => {
  let streamId = "";
  let hostUid = 0;

  it("host goes live and finds sellers to invite (followed first; blocked, buyers and self excluded)", async () => {
    const start = await as(HOST, "/start", { title: "Collab drop" });
    expect(start.status).toBe(201);
    streamId = start.body.stream.id;
    hostUid = start.body.stream.agoraUid;

    const found = await as(HOST, "/cohost-candidates?q=", undefined, "GET");
    expect(found.status).toBe(200);
    const ids = found.body.sellers.map((s: any) => s.userId);
    expect(ids).toEqual(expect.arrayContaining([CO1, CO2, CO3, CO4]));
    expect(ids).not.toContain(HOST);
    expect(ids).not.toContain(BUYER);
    expect(ids).not.toContain(BLOCKED_SELLER);
    // The one the host follows sorts ahead of the rest of this run's sellers.
    const mine = found.body.sellers.filter((s: any) => ALL.includes(s.userId));
    expect(mine[0]).toMatchObject({ userId: CO1, followed: true, displayName: "Rue Studio" });

    const searched = await as(HOST, "/cohost-candidates?q=loom", undefined, "GET");
    expect(searched.body.sellers.map((s: any) => s.userId)).toEqual([CO2]);
  });

  it("refuses bad invites: not the host, a buyer, a blocked seller, yourself", async () => {
    expect((await as(CO1, `/${streamId}/cohost/invite`, { userId: CO2 })).status).toBe(403);
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: BUYER })).body.error).toBe("Only sellers can co-host");
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: BLOCKED_SELLER })).status).toBe(400);
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: HOST })).status).toBe(400);
  });

  it("invite → the invitee gets an Activity invite that deep-links to the accept screen", async () => {
    const invited = await as(HOST, `/${streamId}/cohost/invite`, { userId: CO1 });
    expect(invited.status).toBe(201);
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: CO1 })).status).toBe(409);

    const [note] = await db.select().from(notificationsFeed)
      .where(eq(notificationsFeed.userId, CO1));
    expect(note).toMatchObject({
      type: "live_cohost_invite", targetType: "live_cohost", targetId: streamId,
      title: "Atelier Nine invited you to co-host their live",
    });

    const pending = await as(CO1, "/cohost-invites", undefined, "GET");
    expect(pending.body.invites).toEqual([expect.objectContaining({ streamId, hostName: "Atelier Nine", title: "Collab drop" })]);
  });

  it("accept → Agora publisher creds on the host's channel with a distinct uid; the room learns the co-host list", async () => {
    const viewer = await socketFor(streamId, BUYER);
    try {
      const accepted = await as(CO1, `/${streamId}/cohost/respond`, { accept: true });
      expect(accepted.status).toBe(200);
      const [stream] = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId));
      expect(accepted.body).toMatchObject({ ok: true, status: "accepted", channelName: stream.channelName, agoraAppId: "test-agora-app" });
      expect(typeof accepted.body.agoraUid).toBe("number");
      expect(accepted.body.agoraUid).not.toBe(hostUid);

      const ev = await waitForEvent(viewer.events, (e) => e.type === "cohosts" && e.cohosts.length === 1);
      expect(ev.cohosts[0]).toMatchObject({ userId: CO1, displayName: "Rue Studio", agoraUid: accepted.body.agoraUid });
      expect((await as(BUYER, `/${streamId}/cohosts`, undefined, "GET")).body.cohosts.map((c: any) => c.userId)).toEqual([CO1]);

      // Rejoin: same uid, fresh token. Only an accepted co-host gets one.
      const token = await as(CO1, `/${streamId}/cohost/token`, {});
      expect(token.status).toBe(200);
      expect(token.body.agoraUid).toBe(accepted.body.agoraUid);
      expect((await as(BUYER, `/${streamId}/cohost/token`, {})).status).toBe(403);
    } finally {
      viewer.ws.close();
    }
  });

  it("an accepted co-host may hold a host socket (not counted as a viewer); anyone else may not", async () => {
    const co = await socketFor(streamId, CO1, true);
    co.ws.close();
    await expect(socketFor(streamId, CO2, true)).rejects.toThrow("ws 403");
    const viewers = await db.select().from(liveViewers).where(eq(liveViewers.streamId, streamId));
    expect(viewers.map((v) => v.userIdOrSessionId)).not.toContain(CO1);
  });

  it("caps open co-hosts, and the host can cancel a pending invite", async () => {
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: CO2 })).status).toBe(201);
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: CO3 })).status).toBe(201);
    const over = await as(HOST, `/${streamId}/cohost/invite`, { userId: CO4 });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatch(/up to 3 co-hosts/);

    expect((await as(HOST, `/${streamId}/cohost/cancel`, { userId: CO3 })).status).toBe(200);
    expect((await as(CO3, `/${streamId}/cohost/respond`, { accept: true })).status).toBe(404);
  });

  it("host removes a co-host and a co-host leaves — every socket is told", async () => {
    const viewer = await socketFor(streamId, BUYER);
    try {
      expect((await as(CO2, `/${streamId}/cohost/respond`, { accept: true })).status).toBe(200);
      await waitForEvent(viewer.events, (e) => e.type === "cohosts" && e.cohosts.length === 2);

      expect((await as(CO1, `/${streamId}/cohost/remove`, { userId: CO2 })).status).toBe(403);
      expect((await as(HOST, `/${streamId}/cohost/remove`, { userId: CO1 })).status).toBe(200);
      await waitForEvent(viewer.events, (e) => e.type === "cohost_removed" && e.userId === CO1);
      await waitForEvent(viewer.events, (e) => e.type === "cohosts" && e.cohosts.length === 1 && e.cohosts[0].userId === CO2);
      expect((await as(CO1, `/${streamId}/cohost/token`, {})).status).toBe(403);

      expect((await as(CO2, `/${streamId}/cohost/leave`, {})).status).toBe(200);
      await waitForEvent(viewer.events, (e) => e.type === "cohosts" && e.cohosts.length === 0);
      const rows = await db.select().from(liveCohosts).where(eq(liveCohosts.streamId, streamId));
      expect(Object.fromEntries(rows.filter((r) => r.cohostId !== CO3).map((r) => [r.cohostId, r.status])))
        .toEqual({ [CO1]: "removed", [CO2]: "left" });
    } finally {
      viewer.ws.close();
    }
  });

  it("a block placed after the invite stops the accept", async () => {
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: CO3 })).status).toBe(201);
    await db.insert(blocks).values({ blockerId: CO3, blockedId: HOST });
    try {
      expect((await as(CO3, `/${streamId}/cohost/respond`, { accept: true })).status).toBe(403);
      // Declining is still allowed.
      expect((await as(CO3, `/${streamId}/cohost/respond`, { accept: false })).body).toMatchObject({ status: "declined" });
    } finally {
      await db.delete(blocks).where(eq(blocks.blockerId, CO3));
    }
  });

  it("ending the live takes every co-host off stage and closes open invites", async () => {
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: CO4 })).status).toBe(201);
    expect((await as(CO4, `/${streamId}/cohost/respond`, { accept: true })).status).toBe(200);
    expect((await as(HOST, `/${streamId}/cohost/invite`, { userId: CO1 })).status).toBe(201);

    const co = await socketFor(streamId, CO4, true);
    try {
      expect((await as(HOST, `/${streamId}/end`, {})).status).toBe(200);
      await waitForEvent(co.events, (e) => e.type === "cohosts" && e.cohosts.length === 0);
      await waitForEvent(co.events, (e) => e.type === "ended");
    } finally {
      co.ws.close();
    }
    const open = await db.execute(sql`
      SELECT count(*)::int AS n FROM live_cohosts WHERE stream_id = ${streamId}::uuid AND status IN ('invited', 'accepted')
    `);
    expect((open.rows[0] as any).n).toBe(0);
    expect((await as(CO1, `/${streamId}/cohost/respond`, { accept: true })).status).toBe(410);
    expect((await as(CO4, `/${streamId}/cohost/token`, {})).status).toBe(410);
    expect((await as(CO1, "/cohost-invites", undefined, "GET")).body.invites).toEqual([]);
  });
});
