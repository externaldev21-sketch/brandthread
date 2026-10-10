/**
 * Item 5 (calls), real Postgres + the real Express routers:
 *   • a muted chat still rings the callee (the "calls" push and the native
 *     VoIP ring both go out) while ordinary message pushes stay muted;
 *   • a block (either direction) refuses the call at create AND at accept,
 *     and blocking someone mid-ring ends the ringing call for both sides;
 *   • an unaccepted message request can't be called by either side until
 *     the recipient accepts it (PATCH /api/conversations/:id/accept);
 *   • POST / DELETE /api/push/voip-token store native call tokens.
 * Only the delivery edges are stubbed: Expo push (sendPushToUser), the
 * APNs/FCM sender (sendCallVoipPush) and the /ws/calls socket.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  blocks, callPushTokens, conversationParticipants, conversations, db, dmCalls, notificationsFeed, users,
} from "@workspace/db";

const spies = vi.hoisted(() => ({
  pushes: [] as Array<{ userId: string; payload: any }>,
  voip: [] as Array<{ userId: string; payload: any }>,
  socket: [] as Array<{ userId: string; payload: any }>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    req.log = { error: () => undefined, warn: () => undefined, info: () => undefined };
    next();
  },
}));

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: vi.fn(async (userId: string, payload: any) => { spies.pushes.push({ userId, payload }); return true; }),
  };
});

vi.mock("../../lib/voipPush", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/voipPush")>();
  return {
    ...actual,
    sendCallVoipPush: vi.fn(async (userId: string, payload: any) => {
      spies.voip.push({ userId, payload });
      return { apns: 1, fcm: 0, removed: 0 };
    }),
  };
});

vi.mock("../../ws/callHub", () => ({
  sendCallEvent: (userId: string, payload: any) => { spies.socket.push({ userId, payload }); return 1; },
}));

const tag = crypto.randomBytes(5).toString("hex");
const CALLER = `callpol-caller-${tag}`;
const CALLEE = `callpol-callee-${tag}`;
const PEOPLE = [CALLER, CALLEE];

let server: Server;
let base = "";
const originalEnv = { ...process.env };

function as(userId: string, path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "x-test-acting-as": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function makeConversation(opts: { isRequest?: boolean; requestedBy?: string | null; calleeMutedUntil?: Date | null } = {}) {
  const [conv] = await db.insert(conversations).values({
    type: "buyer_to_buyer",
    isRequest: opts.isRequest ?? false,
    requestedBy: opts.requestedBy ?? null,
  }).returning({ id: conversations.id });
  await db.insert(conversationParticipants).values([
    { conversationId: conv!.id, userId: CALLER, name: "Ava Caller", initials: "AC" },
    { conversationId: conv!.id, userId: CALLEE, name: "Ben Callee", initials: "BC", mutedUntil: opts.calleeMutedUntil ?? null },
  ]);
  return conv!.id;
}

async function cleanup() {
  const convs = await db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(inArray(conversationParticipants.userId, PEOPLE));
  const ids = [...new Set(convs.map((c) => c.id))];
  if (ids.length) {
    await db.delete(dmCalls).where(inArray(dmCalls.conversationId, ids));
    await db.delete(conversations).where(inArray(conversations.id, ids));
  }
  await db.delete(blocks).where(or(inArray(blocks.blockerId, PEOPLE), inArray(blocks.blockedId, PEOPLE)));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, PEOPLE));
  await db.delete(callPushTokens).where(inArray(callPushTokens.userId, PEOPLE));
  await db.delete(users).where(inArray(users.clerkId, PEOPLE));
}

beforeAll(async () => {
  process.env.AGORA_APP_ID = "test-agora-app-id-0000000000000000";
  process.env.AGORA_APP_CERTIFICATE = "test-agora-certificate-000000000000";
  const [{ default: callRouter }, { default: socialRouter }, { default: pushRouter }, { default: conversationsRouter }] = await Promise.all([
    import("../call"),
    import("../social"),
    import("../push"),
    import("../conversations"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/call", callRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/push", pushRouter);
  app.use("/api/conversations", conversationsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values(PEOPLE.map((id) => ({
    clerkId: id, email: `${id}@example.test`, name: id, displayName: id, accountType: "buyer", onboardingComplete: true,
  })));
  spies.pushes.length = 0;
  spies.voip.length = 0;
  spies.socket.length = 0;
});

afterAll(async () => {
  await cleanup();
  process.env = originalEnv;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Fire-and-forget side effects (push, VoIP) settle on the next ticks. */
async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 10));
}

describe("muted chat still rings", () => {
  it("rings a callee who muted the chat: calls push + native VoIP ring", async () => {
    const conversationId = await makeConversation({ calleeMutedUntil: new Date(Date.now() + 8 * 3600_000) });
    const res = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    expect(res.status).toBe(201);
    const { call } = await res.json() as { call: { id: string } };
    await settle();

    const callPush = spies.pushes.find((p) => p.userId === CALLEE && p.payload.data?.type === "dm_call_incoming");
    expect(callPush, "the incoming-call push must not be dropped by chat mute").toBeTruthy();
    expect(callPush!.payload).toMatchObject({ channelId: "calls", priority: "high" });
    expect(spies.voip).toContainEqual({
      userId: CALLEE,
      payload: expect.objectContaining({
        type: "dm_call_incoming", callId: call.id, callerName: "Ava Caller", hasVideo: false, conversationId,
        // The device drops a ring addressed to another / no signed-in account.
        calleeId: CALLEE, callerId: CALLER,
      }),
    });
    expect(spies.socket.some((e) => e.userId === CALLEE && e.payload.type === "call.incoming")).toBe(true);
  });

  it("an ordinary message notification in the same muted chat stays muted", async () => {
    const conversationId = await makeConversation({ calleeMutedUntil: new Date(Date.now() + 8 * 3600_000) });
    const { publishNotification } = await import("../notifications-feed");
    await publishNotification({
      userId: CALLEE, category: "message", type: "new_message", title: "Ava Caller", body: "hi",
      targetId: conversationId, targetType: "conversation",
    });
    expect(spies.pushes.filter((p) => p.userId === CALLEE)).toHaveLength(0);
  });
});

describe("calls unavailable (no Agora credentials)", () => {
  it("refuses to create a call before any push, VoIP ring or socket event, and reports unavailable", async () => {
    const savedId = process.env.AGORA_APP_ID;
    const savedCert = process.env.AGORA_APP_CERTIFICATE;
    try {
      for (const missing of ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"] as const) {
        process.env.AGORA_APP_ID = savedId;
        process.env.AGORA_APP_CERTIFICATE = savedCert;
        delete process.env[missing];
        // The callee has native ringing tokens; nothing may reach them.
        await as(CALLEE, "/api/push/voip-token", "POST", { token: "d".repeat(64), platform: "ios" });
        const availability = await as(CALLER, "/api/call/availability");
        expect(await availability.json()).toMatchObject({ configured: false });

        const conversationId = await makeConversation();
        const res = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "video" });
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: "CALLING_NOT_CONFIGURED" });
        await settle();
        expect(spies.pushes).toHaveLength(0);
        expect(spies.voip).toHaveLength(0);
        expect(spies.socket).toHaveLength(0);
        expect(await db.select().from(dmCalls).where(eq(dmCalls.conversationId, conversationId))).toHaveLength(0);
      }
    } finally {
      process.env.AGORA_APP_ID = savedId;
      process.env.AGORA_APP_CERTIFICATE = savedCert;
    }
  });
});

describe("block stops calls", () => {
  it("refuses when the callee blocked the caller", async () => {
    const conversationId = await makeConversation();
    await db.insert(blocks).values({ blockerId: CALLEE, blockedId: CALLER });
    const res = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "video" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "BLOCKED" });
    await settle();
    expect(spies.pushes).toHaveLength(0);
    expect(spies.voip).toHaveLength(0);
  });

  it("refuses when the caller blocked the callee", async () => {
    const conversationId = await makeConversation();
    await db.insert(blocks).values({ blockerId: CALLER, blockedId: CALLEE });
    const res = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "BLOCKED" });
  });

  it("blocking someone mid-ring ends the ringing call for both sides and dismisses the native ring", async () => {
    const conversationId = await makeConversation();
    const created = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    const { call } = await created.json() as { call: { id: string } };
    spies.voip.length = 0;
    spies.socket.length = 0;

    const blocked = await as(CALLEE, "/api/social/block", "POST", { userId: CALLER });
    expect(blocked.status).toBe(200);
    await settle();

    const [row] = await db.select().from(dmCalls).where(eq(dmCalls.id, call.id));
    expect(row).toMatchObject({ status: "failed", endReason: "blocked" });
    expect(spies.socket.filter((e) => e.payload.type === "call.updated").map((e) => e.userId).sort())
      .toEqual([CALLEE, CALLER].sort());
    expect(spies.voip).toContainEqual({
      userId: CALLEE,
      payload: expect.objectContaining({ type: "dm_call_ended", callId: call.id, reason: "blocked", calleeId: CALLEE }),
    });
    // The callee can't answer it any more.
    const accept = await as(CALLEE, `/api/call/dm/calls/${call.id}/accept`, "POST", {});
    expect(accept.status).toBe(409);
    // No "missed call" notice for a call ended by a block.
    const feed = await db.select().from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, CALLEE), eq(notificationsFeed.type, "dm_call_missed")));
    expect(feed).toHaveLength(0);
  });

  it("a block written while it rings also refuses the accept (race with the block route)", async () => {
    const conversationId = await makeConversation();
    const created = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    const { call } = await created.json() as { call: { id: string } };
    await db.insert(blocks).values({ blockerId: CALLER, blockedId: CALLEE }); // straight to the table — no route hook

    const accept = await as(CALLEE, `/api/call/dm/calls/${call.id}/accept`, "POST", {});
    expect(accept.status).toBe(403);
    const body = await accept.json() as { code: string; call: { status: string; endReason: string } };
    expect(body.code).toBe("BLOCKED");
    expect(body.call).toMatchObject({ status: "failed", endReason: "blocked" });
  });

  it("blocking during an accepted call ends it", async () => {
    const conversationId = await makeConversation();
    const created = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    const { call } = await created.json() as { call: { id: string } };
    expect((await as(CALLEE, `/api/call/dm/calls/${call.id}/accept`, "POST", {})).status).toBe(200);
    await as(CALLER, "/api/social/block", "POST", { userId: CALLEE });
    const [row] = await db.select().from(dmCalls).where(eq(dmCalls.id, call.id));
    expect(row).toMatchObject({ status: "ended", endReason: "blocked" });
  });

  it("answering dismisses the ring on the callee's other devices (answered elsewhere)", async () => {
    const conversationId = await makeConversation();
    const created = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "video" });
    const { call } = await created.json() as { call: { id: string } };
    spies.voip.length = 0;
    expect((await as(CALLEE, `/api/call/dm/calls/${call.id}/accept`, "POST", {})).status).toBe(200);
    await settle();
    expect(spies.voip).toContainEqual({
      userId: CALLEE,
      payload: expect.objectContaining({ type: "dm_call_ended", callId: call.id, reason: "answered_elsewhere" }),
    });
  });

  it("the caller cancelling dismisses the native ring", async () => {
    const conversationId = await makeConversation();
    const created = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    const { call } = await created.json() as { call: { id: string } };
    spies.voip.length = 0;
    expect((await as(CALLER, `/api/call/dm/calls/${call.id}/end`, "POST", {})).status).toBe(200);
    await settle();
    expect(spies.voip).toContainEqual({
      userId: CALLEE,
      payload: expect.objectContaining({ type: "dm_call_ended", reason: "cancelled" }),
    });
  });
});

describe("message requests", () => {
  it("the requester can't call an unaccepted request; the recipient can't either until they accept", async () => {
    const conversationId = await makeConversation({ isRequest: true, requestedBy: CALLER });

    const fromRequester = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    expect(fromRequester.status).toBe(403);
    expect(await fromRequester.json()).toMatchObject({ code: "CALL_REQUEST_NOT_ACCEPTED" });

    const fromRecipient = await as(CALLEE, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    expect(fromRecipient.status).toBe(403);
    expect(await fromRecipient.json()).toMatchObject({ code: "CALL_REQUEST_PENDING" });

    // Calling never accepts the request implicitly.
    const [still] = await db.select({ isRequest: conversations.isRequest }).from(conversations).where(eq(conversations.id, conversationId));
    expect(still!.isRequest).toBe(true);
    await settle();
    expect(spies.voip).toHaveLength(0);
    expect(spies.pushes).toHaveLength(0);
  });

  it("after the recipient accepts, both sides can call", async () => {
    const conversationId = await makeConversation({ isRequest: true, requestedBy: CALLER });
    const accepted = await as(CALLEE, `/api/conversations/${conversationId}/accept`, "PATCH", {});
    expect(accepted.status).toBe(200);

    const first = await as(CALLER, "/api/call/dm/calls", "POST", { conversationId, mode: "voice" });
    expect(first.status).toBe(201);
    const { call } = await first.json() as { call: { id: string } };
    await as(CALLER, `/api/call/dm/calls/${call.id}/end`, "POST", {});

    const back = await as(CALLEE, "/api/call/dm/calls", "POST", { conversationId, mode: "video" });
    expect(back.status).toBe(201);
  });
});

describe("POST / DELETE /api/push/voip-token", () => {
  const iosToken = "f".repeat(64);
  const fcmToken = "dGVzdC1mY20tdG9rZW4:APA91bH-test_token-1234567890";

  it("registers an iOS VoIP token and an Android FCM token", async () => {
    expect((await as(CALLEE, "/api/push/voip-token", "POST", {
      token: iosToken, platform: "ios", kind: "voip", bundleId: "com.brandthread.mobile", environment: "sandbox",
    })).status).toBe(200);
    expect((await as(CALLEE, "/api/push/voip-token", "POST", { token: fcmToken, platform: "android" })).status).toBe(200);
    const rows = await db.select().from(callPushTokens).where(eq(callPushTokens.userId, CALLEE));
    expect(rows.map((r) => ({ kind: r.kind, platform: r.platform, bundleId: r.bundleId, environment: r.environment })).sort((a, b) => a.kind.localeCompare(b.kind)))
      .toEqual([
        { kind: "fcm", platform: "android", bundleId: null, environment: null },
        { kind: "voip", platform: "ios", bundleId: "com.brandthread.mobile", environment: "sandbox" },
      ]);
  });

  it("moves a token to whoever registers it last (shared device) and is idempotent", async () => {
    await as(CALLEE, "/api/push/voip-token", "POST", { token: iosToken, platform: "ios" });
    await as(CALLER, "/api/push/voip-token", "POST", { token: iosToken, platform: "ios" });
    await as(CALLER, "/api/push/voip-token", "POST", { token: iosToken, platform: "ios" });
    const rows = await db.select().from(callPushTokens).where(eq(callPushTokens.token, iosToken));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(CALLER);
  });

  it("validates input", async () => {
    expect((await as(CALLEE, "/api/push/voip-token", "POST", { token: "short", platform: "ios" })).status).toBe(400);
    expect((await as(CALLEE, "/api/push/voip-token", "POST", { token: iosToken, platform: "web" })).status).toBe(400);
    expect((await as(CALLEE, "/api/push/voip-token", "POST", { token: iosToken, platform: "ios", kind: "fcm" })).status).toBe(400);
    expect((await as(CALLEE, "/api/push/voip-token", "POST", { token: iosToken, platform: "ios", environment: "prod" })).status).toBe(400);
    const unauth = await fetch(`${base}/api/push/voip-token`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(unauth.status).toBe(401);
  });

  it("DELETE removes only the caller's own token", async () => {
    await as(CALLEE, "/api/push/voip-token", "POST", { token: iosToken, platform: "ios" });
    expect((await as(CALLER, "/api/push/voip-token", "DELETE", { token: iosToken })).status).toBe(200);
    expect(await db.select().from(callPushTokens).where(eq(callPushTokens.token, iosToken))).toHaveLength(1);
    expect((await as(CALLEE, "/api/push/voip-token", "DELETE", { token: iosToken })).status).toBe(200);
    expect(await db.select().from(callPushTokens).where(eq(callPushTokens.token, iosToken))).toHaveLength(0);
  });
});
