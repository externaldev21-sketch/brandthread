import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// A tiny in-memory stand-in for the drizzle query builder: drizzle-orm's
// operators are mocked to plain condition objects, table columns resolve to
// their property names, and the fake db evaluates them against row arrays.
const state = vi.hoisted(() => {
  type Row = Record<string, any>;
  type Cond = { op: string; col?: string; val?: unknown; conds?: Cond[] } | undefined;
  const tables: Record<string, Row[]> = {};
  const evalCond = (c: Cond, row: Row): boolean => {
    if (!c) return true;
    if (c.op === "eq") return row[c.col!] === c.val;
    if (c.op === "in") return (c.val as unknown[]).includes(row[c.col!]);
    if (c.op === "and") return c.conds!.every((x) => evalCond(x, row));
    if (c.op === "or") return c.conds!.some((x) => evalCond(x, row));
    throw new Error(`unsupported op ${c.op}`);
  };
  return {
    userId: "caller-user",
    tables,
    published: [] as Array<Record<string, any>>,
    events: [] as Array<{ userId: string; payload: Record<string, any> }>,
    beforeUpdate: null as null | (() => void),
    evalCond,
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = state.userId;
    req.log = { error: () => undefined };
    next();
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...conds: unknown[]) => ({ op: "and", conds }),
  or: (...conds: unknown[]) => ({ op: "or", conds }),
  eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
  inArray: (col: string, val: unknown[]) => ({ op: "in", col, val }),
  desc: (col: string) => ({ desc: col }),
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ __table: name } as Record<string, unknown>, {
    get: (target, key) => key in target ? target[key as string] : String(key),
  });
  const rowsOf = (t: any) => (state.tables[t.__table] ??= []);
  const query = (projection: Record<string, string> | undefined, t: any) => {
    let cond: any;
    let order: any;
    let limit = Infinity;
    const run = () => {
      let rows = rowsOf(t).filter((r) => state.evalCond(cond, r));
      if (order) rows = [...rows].sort((a, b) => b[order.desc].getTime() - a[order.desc].getTime());
      rows = rows.slice(0, limit);
      return rows.map((r) => projection
        ? Object.fromEntries(Object.entries(projection).map(([k, col]) => [k, r[col]]))
        : { ...r });
    };
    const builder: any = {
      where: (c: unknown) => { cond = c; return builder; },
      orderBy: (o: unknown) => { order = o; return builder; },
      limit: (n: number) => { limit = n; return builder; },
      then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  return {
    conversations: table("conversations"),
    conversationParticipants: table("conversationParticipants"),
    blocks: table("blocks"),
    users: table("users"),
    dmCalls: table("dmCalls"),
    manufacturerActivityEvents: table("manufacturerActivityEvents"),
    manufacturers: table("manufacturers"),
    manufacturerThreads: table("manufacturerThreads"),
    db: {
      select: (projection?: Record<string, string>) => ({ from: (t: unknown) => query(projection, t) }),
      insert: (t: any) => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => {
            const rows = rowsOf(t);
            if (t.__table === "dmCalls" && rows.some((r) => r.conversationId === v.conversationId
              && (r.status === "ringing" || r.status === "accepted"))) {
              throw Object.assign(new Error("duplicate"), { code: "23505" });
            }
            const row = {
              createdAt: new Date(), answeredAt: null, endedAt: null, endedBy: null, endReason: null,
              qualityRatingCaller: null, qualityRatingCallee: null, ...v,
            };
            rows.push(row);
            return [{ ...row }];
          },
        }),
      }),
      update: (t: any) => ({
        set: (patch: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            const apply = () => {
              state.beforeUpdate?.();
              state.beforeUpdate = null;
              const hit = rowsOf(t).filter((r) => state.evalCond(cond as any, r));
              for (const r of hit) Object.assign(r, patch);
              return hit.map((r) => ({ ...r }));
            };
            const p: any = Promise.resolve().then(apply);
            p.returning = () => p;
            return p;
          },
        }),
      }),
    },
  };
});

vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: Record<string, unknown>) => { state.published.push(n); },
}));

vi.mock("../../ws/callHub", () => ({
  sendCallEvent: (userId: string, payload: Record<string, any>) => { state.events.push({ userId, payload }); return 1; },
}));

import callRouter from "../call";

const CONV = "aaaaaaaa-0000-4000-8000-000000000001";
const GROUP = "aaaaaaaa-0000-4000-8000-000000000002";
const OTHER_CONV = "aaaaaaaa-0000-4000-8000-000000000003";

let server: Server;
let base = "";
const originalEnv = { ...process.env };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/call", callRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: String(err?.stack ?? err) });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  process.env = originalEnv;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.userId = "caller-user";
  state.published = [];
  state.events = [];
  state.beforeUpdate = null;
  for (const k of Object.keys(state.tables)) delete state.tables[k];
  state.tables.conversations = [
    { id: CONV, deletedAt: null }, { id: GROUP, deletedAt: null }, { id: OTHER_CONV, deletedAt: null },
  ];
  state.tables.conversationParticipants = [
    { conversationId: CONV, userId: "caller-user", name: "Ava Stone", initials: "AS", color: "#111111" },
    { conversationId: CONV, userId: "callee-user", name: "Maison Vela", initials: "MV", color: "#222222" },
    { conversationId: GROUP, userId: "caller-user", name: "Ava Stone", initials: "AS", color: "#111111" },
    { conversationId: GROUP, userId: "callee-user", name: "Maison Vela", initials: "MV", color: "#222222" },
    { conversationId: GROUP, userId: "third-user", name: "Third", initials: "T", color: "#333333" },
    { conversationId: OTHER_CONV, userId: "callee-user", name: "Maison Vela", initials: "MV", color: "#222222" },
    { conversationId: OTHER_CONV, userId: "third-user", name: "Third", initials: "T", color: "#333333" },
  ];
  state.tables.users = [
    { clerkId: "caller-user", profileImageUrl: "https://img/ava.png", avatarUrl: null },
    { clerkId: "callee-user", profileImageUrl: null, avatarUrl: "https://img/maison.png" },
  ];
  state.tables.blocks = [];
  state.tables.dmCalls = [];
  process.env.AGORA_APP_ID = "0123456789abcdef0123456789abcdef";
  process.env.AGORA_APP_CERTIFICATE = "fedcba9876543210fedcba9876543210";
});

async function api(method: string, path: string, body?: unknown, as?: string) {
  if (as) state.userId = as;
  const response = await fetch(`${base}/api/call${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function placeCall(mode = "voice") {
  const r = await api("POST", "/dm/calls", { conversationId: CONV, mode }, "caller-user");
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  state.published = [];
  state.events = [];
  return r.body.call.id as string;
}

function seedCall(overrides: Record<string, unknown>) {
  const row = {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    conversationId: CONV,
    callerId: "caller-user",
    calleeId: "callee-user",
    mode: "voice",
    status: "ringing",
    channelName: "dmcall_bbbbbbbb000040008000000000000001",
    createdAt: new Date(),
    answeredAt: null,
    endedAt: null,
    endedBy: null,
    endReason: null,
    qualityRatingCaller: null,
    qualityRatingCallee: null,
    ...overrides,
  };
  state.tables.dmCalls.push(row);
  return row;
}

describe("POST /api/call/dm/calls", () => {
  it("validates the body", async () => {
    expect((await api("POST", "/dm/calls", { mode: "voice" })).status).toBe(400);
    expect((await api("POST", "/dm/calls", { conversationId: CONV, mode: "fax" })).status).toBe(400);
  });

  it("answers 503 CALLING_NOT_CONFIGURED without creating or ringing anything", async () => {
    delete process.env.AGORA_APP_CERTIFICATE;
    const r = await api("POST", "/dm/calls", { conversationId: CONV, mode: "voice" });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("CALLING_NOT_CONFIGURED");
    expect(state.tables.dmCalls).toHaveLength(0);
    expect(state.published).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("refuses non-participants, group conversations and blocks (either way)", async () => {
    expect((await api("POST", "/dm/calls", { conversationId: CONV, mode: "voice" }, "stranger")).status).toBe(403);
    expect((await api("POST", "/dm/calls", { conversationId: GROUP, mode: "voice" }, "caller-user")).status).toBe(403);
    state.tables.blocks = [{ blockerId: "callee-user", blockedId: "caller-user" }];
    const blocked = await api("POST", "/dm/calls", { conversationId: CONV, mode: "voice" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("BLOCKED");
    state.tables.blocks = [{ blockerId: "caller-user", blockedId: "callee-user" }];
    expect((await api("POST", "/dm/calls", { conversationId: CONV, mode: "voice" })).status).toBe(403);
    expect(state.tables.dmCalls).toHaveLength(0);
    expect(state.published).toHaveLength(0);
  });

  it("409 CALLEE_BUSY / CALLER_BUSY when either side has a live call", async () => {
    seedCall({ id: "cccccccc-0000-4000-8000-000000000001", conversationId: OTHER_CONV, callerId: "third-user", calleeId: "callee-user", status: "accepted", answeredAt: new Date() });
    const busy = await api("POST", "/dm/calls", { conversationId: CONV, mode: "voice" });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("CALLEE_BUSY");

    state.tables.dmCalls = [];
    seedCall({ id: "cccccccc-0000-4000-8000-000000000002", conversationId: OTHER_CONV, callerId: "caller-user", calleeId: "third-user", status: "ringing" });
    const callerBusy = await api("POST", "/dm/calls", { conversationId: CONV, mode: "voice" });
    expect(callerBusy.status).toBe(409);
    expect(callerBusy.body.code).toBe("CALLER_BUSY");
    expect(state.published).toHaveLength(0);
  });

  it("a stale ringing call doesn't make anyone busy (it becomes missed)", async () => {
    seedCall({ status: "ringing", createdAt: new Date(Date.now() - 60_000) });
    const r = await api("POST", "/dm/calls", { conversationId: CONV, mode: "voice" });
    expect(r.status).toBe(201);
    expect(state.tables.dmCalls[0]!.status).toBe("missed");
  });

  it("201 creates a ringing call, returns caller credentials, pushes and signals the callee", async () => {
    const r = await api("POST", "/dm/calls", { conversationId: CONV, mode: "video" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { call, rtc } = r.body;
    expect(call).toMatchObject({
      conversationId: CONV,
      mode: "video",
      status: "ringing",
      direction: "outgoing",
      callerId: "caller-user",
      calleeId: "callee-user",
      peer: { id: "callee-user", name: "Maison Vela", initials: "MV", color: "#222222", avatarUrl: "https://img/maison.png" },
      answeredAt: null,
      endedAt: null,
      durationSec: null,
      endReason: null,
    });
    expect(rtc).toMatchObject({
      appId: "0123456789abcdef0123456789abcdef",
      channelName: `dmcall_${call.id.replaceAll("-", "")}`,
    });
    expect(typeof rtc.token).toBe("string");
    expect(rtc.token.length).toBeGreaterThan(20);
    expect(typeof rtc.uid).toBe("number");
    expect(new Date(rtc.expiresAt).getTime()).toBeGreaterThan(Date.now());

    expect(state.published).toEqual([expect.objectContaining({
      userId: "callee-user",
      type: "dm_call_incoming",
      targetType: "conversation",
      targetId: CONV,
      title: "Incoming video call",
      body: "Ava Stone is calling you",
      pushCategory: "message",
      pushChannelId: "calls",
      pushSound: "default",
      pushPriority: "high",
      extraData: {
        targetType: "dm_call",
        targetId: call.id,
        callId: call.id,
        conversationId: CONV,
        mode: "video",
        actorName: "Ava Stone",
      },
    })]);
    expect(state.events).toEqual([{
      userId: "callee-user",
      payload: {
        type: "call.incoming",
        call: expect.objectContaining({
          id: call.id,
          direction: "incoming",
          peer: expect.objectContaining({ id: "caller-user", avatarUrl: "https://img/ava.png" }),
        }),
      },
    }]);
  });
});

describe("accept / decline / end", () => {
  it("only the callee can accept; accept returns credentials and notifies both", async () => {
    const id = await placeCall();
    expect((await api("POST", `/dm/calls/${id}/accept`, {}, "caller-user")).status).toBe(403);
    expect((await api("POST", `/dm/calls/${id}/accept`, {}, "stranger")).status).toBe(403);

    const r = await api("POST", `/dm/calls/${id}/accept`, {}, "callee-user");
    expect(r.status).toBe(200);
    expect(r.body.call).toMatchObject({ status: "accepted", direction: "incoming" });
    expect(r.body.call.answeredAt).toBeTruthy();
    expect(r.body.rtc.channelName).toBe(`dmcall_${id.replaceAll("-", "")}`);
    expect(state.events.map((e) => [e.userId, e.payload.type, e.payload.call.status, e.payload.call.direction])).toEqual([
      ["caller-user", "call.updated", "accepted", "outgoing"],
      ["callee-user", "call.updated", "accepted", "incoming"],
    ]);

    // Idempotent repeat.
    const again = await api("POST", `/dm/calls/${id}/accept`, {}, "callee-user");
    expect(again.status).toBe(200);
    expect(again.body.rtc).toBeTruthy();

    // Declining an accepted call is not a valid transition.
    const bad = await api("POST", `/dm/calls/${id}/decline`, {}, "callee-user");
    expect(bad.status).toBe(409);
    expect(bad.body).toMatchObject({ code: "INVALID_CALL_STATE", call: { status: "accepted" } });
  });

  it("accept refuses 503 when calling is not configured", async () => {
    const id = await placeCall();
    delete process.env.AGORA_APP_ID;
    const r = await api("POST", `/dm/calls/${id}/accept`, {}, "callee-user");
    expect(r.status).toBe(503);
    expect(state.tables.dmCalls[0]!.status).toBe("ringing");
  });

  it("callee declines a ringing call; repeat is idempotent; accept after decline is 409", async () => {
    const id = await placeCall();
    const r = await api("POST", `/dm/calls/${id}/decline`, {}, "callee-user");
    expect(r.status).toBe(200);
    expect(r.body.call).toMatchObject({ status: "declined", endReason: "declined" });
    expect(state.events).toHaveLength(2);
    expect(state.published).toHaveLength(0);
    expect((await api("POST", `/dm/calls/${id}/decline`, {}, "callee-user")).status).toBe(200);
    expect((await api("POST", `/dm/calls/${id}/decline`, {}, "caller-user")).status).toBe(403);
    const late = await api("POST", `/dm/calls/${id}/accept`, {}, "callee-user");
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("INVALID_CALL_STATE");
  });

  it("caller hanging up while ringing cancels and leaves a missed-call notice for the callee", async () => {
    const id = await placeCall("voice");
    const r = await api("POST", `/dm/calls/${id}/end`, {}, "caller-user");
    expect(r.status).toBe(200);
    expect(r.body.call.status).toBe("cancelled");
    expect(state.published).toEqual([expect.objectContaining({
      userId: "callee-user",
      type: "dm_call_missed",
      title: "Missed voice call",
      targetType: "conversation",
      targetId: CONV,
    })]);
    expect(state.published[0]!.pushChannelId).toBeUndefined();
    // Idempotent: no second notice.
    expect((await api("POST", `/dm/calls/${id}/end`, {}, "caller-user")).status).toBe(200);
    expect(state.published).toHaveLength(1);
  });

  it("callee ending while ringing declines", async () => {
    const id = await placeCall();
    const r = await api("POST", `/dm/calls/${id}/end`, {}, "callee-user");
    expect(r.body.call.status).toBe("declined");
  });

  it("either side ends an accepted call, with a duration", async () => {
    const id = await placeCall();
    await api("POST", `/dm/calls/${id}/accept`, {}, "callee-user");
    state.tables.dmCalls[0]!.answeredAt = new Date(Date.now() - 90_000);
    state.events = [];
    const r = await api("POST", `/dm/calls/${id}/end`, {}, "callee-user");
    expect(r.status).toBe(200);
    expect(r.body.call).toMatchObject({ status: "ended", endReason: "hangup" });
    expect(r.body.call.durationSec).toBeGreaterThanOrEqual(89);
    expect(state.tables.dmCalls[0]!.endedBy).toBe("callee-user");
    expect(state.events.map((e) => e.userId)).toEqual(["caller-user", "callee-user"]);
    expect((await api("POST", `/dm/calls/${id}/end`, {}, "caller-user")).status).toBe(200);
  });

  it("a transition that loses a race answers 409 with the winning state", async () => {
    const id = await placeCall();
    state.beforeUpdate = () => { state.tables.dmCalls[0]!.status = "cancelled"; };
    const r = await api("POST", `/dm/calls/${id}/accept`, {}, "callee-user");
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "INVALID_CALL_STATE", call: { status: "cancelled" } });
    expect(state.events).toHaveLength(0);
  });

  it("unknown call ids are 404", async () => {
    expect((await api("POST", "/dm/calls/not-a-uuid/accept", {}, "callee-user")).status).toBe(404);
    expect((await api("GET", "/dm/calls/dddddddd-0000-4000-8000-000000000001")).status).toBe(404);
  });
});

describe("lazy missed timeout, incoming, token, log", () => {
  it("a ringing call older than 45s reads as missed, notifying once", async () => {
    const row = seedCall({ createdAt: new Date(Date.now() - 46_000) });
    const r = await api("GET", `/dm/calls/${row.id}`, undefined, "caller-user");
    expect(r.status).toBe(200);
    expect(r.body.call).toMatchObject({ status: "missed", endReason: "missed", direction: "outgoing" });
    expect(state.published.filter((n) => n.type === "dm_call_missed")).toHaveLength(1);
    expect(state.events.map((e) => [e.userId, e.payload.type])).toEqual([
      ["caller-user", "call.updated"], ["callee-user", "call.updated"],
    ]);
    await api("GET", `/dm/calls/${row.id}`, undefined, "callee-user");
    expect(state.published).toHaveLength(1);
    expect((await api("POST", `/dm/calls/${row.id}/accept`, {}, "callee-user")).status).toBe(409);
  });

  it("GET /dm/incoming returns the newest live ringing call for the callee", async () => {
    expect((await api("GET", "/dm/incoming", undefined, "callee-user")).body).toEqual({ call: null });
    seedCall({ id: "eeeeeeee-0000-4000-8000-000000000001", createdAt: new Date(Date.now() - 50_000) });
    seedCall({ id: "eeeeeeee-0000-4000-8000-000000000002", conversationId: OTHER_CONV, callerId: "third-user", createdAt: new Date(Date.now() - 5_000) });
    const r = await api("GET", "/dm/incoming", undefined, "callee-user");
    expect(r.body.call).toMatchObject({ id: "eeeeeeee-0000-4000-8000-000000000002", direction: "incoming", peer: { id: "third-user" } });
    expect(state.tables.dmCalls[0]!.status).toBe("missed");
    expect((await api("GET", "/dm/incoming", undefined, "caller-user")).body).toEqual({ call: null });
  });

  it("token renewal: accepted participants and a ringing caller only", async () => {
    const id = await placeCall();
    expect((await api("POST", `/dm/calls/${id}/token`, {}, "caller-user")).status).toBe(200);
    const early = await api("POST", `/dm/calls/${id}/token`, {}, "callee-user");
    expect(early.status).toBe(409);
    await api("POST", `/dm/calls/${id}/accept`, {}, "callee-user");
    const r = await api("POST", `/dm/calls/${id}/token`, {}, "callee-user");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.rtc).sort()).toEqual(["appId", "channelName", "expiresAt", "token", "uid"]);
    delete process.env.AGORA_APP_ID;
    expect((await api("POST", `/dm/calls/${id}/token`, {}, "callee-user")).status).toBe(503);
  });

  it("lists the conversation's calls newest first for both sides", async () => {
    seedCall({ id: "ffffffff-0000-4000-8000-000000000001", status: "ended", createdAt: new Date(Date.now() - 600_000), answeredAt: new Date(Date.now() - 590_000), endedAt: new Date(Date.now() - 530_000) });
    seedCall({ id: "ffffffff-0000-4000-8000-000000000002", callerId: "callee-user", calleeId: "caller-user", status: "missed", createdAt: new Date(Date.now() - 60_000) });
    seedCall({ id: "ffffffff-0000-4000-8000-000000000003", conversationId: OTHER_CONV, callerId: "third-user", status: "ended" });
    const forCaller = await api("GET", `/dm/conversations/${CONV}/calls`, undefined, "caller-user");
    expect(forCaller.status).toBe(200);
    expect(forCaller.body.calls.map((c: any) => [c.id.slice(-1), c.direction, c.durationSec])).toEqual([
      ["2", "incoming", null], ["1", "outgoing", 60],
    ]);
    const forCallee = await api("GET", `/dm/conversations/${CONV}/calls?limit=1`, undefined, "callee-user");
    expect(forCallee.body.calls).toHaveLength(1);
    expect(forCallee.body.calls[0]).toMatchObject({ direction: "outgoing", peer: { id: "caller-user" } });
    expect((await api("GET", `/dm/conversations/${CONV}/calls`, undefined, "third-user")).status).toBe(403);
  });
});

describe("POST /dm/calls/:id/rating", () => {
  it("stores each side's rating for an answered, finished call (overwrite allowed)", async () => {
    const row = seedCall({ status: "ended", answeredAt: new Date(Date.now() - 60_000), endedAt: new Date() });
    expect((await api("POST", `/dm/calls/${row.id}/rating`, { rating: "great" }, "caller-user")).status).toBe(400);
    expect((await api("POST", `/dm/calls/${row.id}/rating`, { rating: "good" }, "caller-user")).body).toEqual({ ok: true });
    expect((await api("POST", `/dm/calls/${row.id}/rating`, { rating: "not_good" }, "callee-user")).status).toBe(200);
    expect((await api("POST", `/dm/calls/${row.id}/rating`, { rating: "not_good" }, "caller-user")).status).toBe(200);
    expect(state.tables.dmCalls[0]).toMatchObject({ qualityRatingCaller: "not_good", qualityRatingCallee: "not_good" });
    expect((await api("POST", `/dm/calls/${row.id}/rating`, { rating: "good" }, "stranger")).status).toBe(403);
  });

  it("409 for a call that is still live or was never answered", async () => {
    const live = seedCall({ status: "accepted", answeredAt: new Date() });
    const r = await api("POST", `/dm/calls/${live.id}/rating`, { rating: "good" }, "caller-user");
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("INVALID_CALL_STATE");
    state.tables.dmCalls = [];
    const missed = seedCall({ status: "missed", endedAt: new Date() });
    expect((await api("POST", `/dm/calls/${missed.id}/rating`, { rating: "good" }, "callee-user")).status).toBe(409);
  });
});
