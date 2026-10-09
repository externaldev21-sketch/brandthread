/**
 * Private accounts: follow -> request -> approve, decline, cancel, the
 * private -> public toggle, and Close Friends replace/validation.
 *
 * No Postgres in this sandbox (see social-follower-management.test.ts), so the
 * real express routers run against a scripted `@workspace/db` mock: each
 * `select` / `tx.delete` / `tx.insert` call shifts the next scripted result.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const s = vi.hoisted(() => ({
  selects: [] as any[][],
  txDeletes: [] as any[][],
  txInserts: [] as any[][],
  txSelects: [] as any[][],
  inserted: [] as Array<{ table: string; values: any }>,
  deleted: [] as string[],
  executed: [] as string[],
  notifications: [] as any[],
  promoted: [] as any[],
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({ __name: name }, {
    get: (t: any, p) => (p === "__name" ? name : typeof p === "string" ? `${name}.${p}` : undefined),
  });
  const chain = (next: () => any[]): any => {
    const c: any = {};
    for (const m of ["from", "where", "innerJoin", "orderBy", "limit", "offset", "set", "onConflictDoNothing"]) c[m] = () => c;
    c.returning = () => Promise.resolve(next());
    c.then = (res: any, rej: any) => Promise.resolve(next()).then(res, rej);
    return c;
  };
  const tx = {
    execute: vi.fn(async (q: any) => { s.executed.push(JSON.stringify(q?.queryChunks ?? q)); return { rows: [] }; }),
    delete: vi.fn((t: any) => { s.deleted.push(t.__name); return chain(() => s.txDeletes.shift() ?? []); }),
    insert: vi.fn((t: any) => ({
      values: (v: any) => { s.inserted.push({ table: t.__name, values: v }); return chain(() => s.txInserts.shift() ?? []); },
    })),
    select: vi.fn(() => chain(() => s.txSelects.shift() ?? [])),
  };
  return {
    db: {
      select: vi.fn(() => chain(() => s.selects.shift() ?? [])),
      transaction: vi.fn(async (cb: any) => cb(tx)),
    },
    users: table("users"), follows: table("follows"), followRequests: table("follow_requests"),
    closeFriends: table("close_friends"), blocks: table("blocks"), notificationsFeed: table("notifications_feed"),
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = req.header("x-test-user-id") || "me-1"; next(); },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _r: any, next: () => void) => next() }));
vi.mock("../notifications-feed", () => ({ publishNotification: async (n: any) => { s.notifications.push(n); } }));
vi.mock("../../lib/safety", () => ({
  profilesById: async (ids: string[]) => new Map(ids.map((id) => [id, {
    userId: id, name: "Me", handle: "@me", initials: "ME", deleted: false, suspended: false,
  }])),
}));
vi.mock("../../lib/conversationRouting", () => ({
  promotePendingRequestsOnFollow: async (...a: any[]) => { s.promoted.push(a); },
}));

async function start() {
  const { default: router } = await import("../follow-requests");
  const app = express();
  app.use(express.json());
  app.use("/api/social", router);
  const server: Server = await new Promise((r) => { const x = app.listen(0, "127.0.0.1", () => r(x)); });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/social` };
}

beforeEach(() => {
  s.selects = []; s.txDeletes = []; s.txInserts = []; s.txSelects = [];
  s.inserted = []; s.deleted = []; s.executed = []; s.notifications = []; s.promoted = [];
});

describe("follow request approval", () => {
  it("approve deletes the request and inserts the follows row in one transaction, then notifies the requester", async () => {
    s.txDeletes = [[{ requesterId: "req-1", targetId: "me-1" }]];
    s.txSelects = [[]]; // no block
    s.txInserts = [[{ followerId: "req-1", followingId: "me-1" }]];
    const { server, base } = await start();
    try {
      const res = await fetch(`${base}/follow-requests/req-1/approve`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, status: "approved" });
      expect(s.inserted).toEqual([{ table: "follows", values: { followerId: "req-1", followingId: "me-1" } }]);
      expect(s.deleted).toContain("follow_requests");
      await new Promise((r) => setTimeout(r, 10));
      expect(s.notifications[0]).toMatchObject({ userId: "req-1", type: "follow_request_accepted" });
      expect(s.promoted).toEqual([["req-1", "me-1"]]);
    } finally { server.close(); }
  });

  it("approve is 404 when no request exists (no follow inserted)", async () => {
    s.txDeletes = [[]];
    const { server, base } = await start();
    try {
      const res = await fetch(`${base}/follow-requests/req-1/approve`, { method: "POST" });
      expect(res.status).toBe(404);
      expect(s.inserted).toEqual([]);
    } finally { server.close(); }
  });

  it("approve drops the request but creates no follow when a block exists", async () => {
    s.txDeletes = [[{ requesterId: "req-1" }]];
    s.txSelects = [[{ b: "me-1" }]];
    const { server, base } = await start();
    try {
      const res = await fetch(`${base}/follow-requests/req-1/approve`, { method: "POST" });
      expect(res.status).toBe(404);
      expect(s.inserted).toEqual([]);
    } finally { server.close(); }
  });

  it("decline only deletes the request", async () => {
    s.txDeletes = [[{ requesterId: "req-1" }]];
    const { server, base } = await start();
    try {
      const res = await fetch(`${base}/follow-requests/req-1/decline`, { method: "POST" });
      expect(await res.json()).toEqual({ ok: true, status: "declined" });
      expect(s.inserted).toEqual([]);
      expect(s.notifications).toEqual([]);
    } finally { server.close(); }
  });
});

describe("GET /follow-requests", () => {
  it("lists incoming requests with person fields", async () => {
    s.selects = [[{
      clerkId: "req-1", name: "Ada", displayName: null, username: "ada",
      profileImageUrl: "https://x/y.jpg", avatarUrl: null, requestedAt: "2026-01-01T00:00:00Z",
    }]];
    const { server, base } = await start();
    try {
      const body = await (await fetch(`${base}/follow-requests`)).json();
      expect(body).toEqual([{
        userId: "req-1", name: "Ada", username: "ada", handle: "@ada",
        avatarUrl: "https://x/y.jpg", requestedAt: "2026-01-01T00:00:00Z",
      }]);
    } finally { server.close(); }
  });
});

describe("close friends", () => {
  const put = (base: string, body: unknown) =>
    fetch(`${base}/close-friends`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("replaces the whole list (delete then insert) and drops the owner + duplicates", async () => {
    s.selects = [[{ clerkId: "a" }, { clerkId: "b" }], []]; // exist, blocks
    const { server, base } = await start();
    try {
      const res = await put(base, { friendIds: ["a", "b", "a", "me-1"] });
      expect(await res.json()).toEqual({ ok: true, friendIds: ["a", "b"], skipped: [] });
      expect(s.deleted).toEqual(["close_friends"]);
      expect(s.inserted[0].values).toEqual([
        { ownerId: "me-1", friendId: "a" }, { ownerId: "me-1", friendId: "b" },
      ]);
    } finally { server.close(); }
  });

  it("an empty list clears everything", async () => {
    const { server, base } = await start();
    try {
      const res = await put(base, { friendIds: [] });
      expect(await res.json()).toEqual({ ok: true, friendIds: [], skipped: [] });
      expect(s.deleted).toEqual(["close_friends"]);
      expect(s.inserted).toEqual([]);
    } finally { server.close(); }
  });

  it("rejects more than 500 and non-array bodies", async () => {
    const { server, base } = await start();
    try {
      const big = Array.from({ length: 501 }, (_, i) => `u${i}`);
      expect((await put(base, { friendIds: big })).status).toBe(400);
      expect((await put(base, { friendIds: "a" })).status).toBe(400);
      expect(s.deleted).toEqual([]);
    } finally { server.close(); }
  });

  it("rejects unknown users without writing", async () => {
    s.selects = [[{ clerkId: "a" }]];
    const { server, base } = await start();
    try {
      const res = await put(base, { friendIds: ["a", "ghost"] });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).invalid).toEqual(["ghost"]);
      expect(s.deleted).toEqual([]);
    } finally { server.close(); }
  });

  it("skips blocked users instead of saving them", async () => {
    s.selects = [[{ clerkId: "a" }, { clerkId: "b" }], [{ a: "me-1", b: "b" }]];
    const { server, base } = await start();
    try {
      const res = await put(base, { friendIds: ["a", "b"] });
      expect(await res.json()).toEqual({ ok: true, friendIds: ["a"], skipped: ["b"] });
    } finally { server.close(); }
  });

  it("GET returns ids and people", async () => {
    s.selects = [[{
      clerkId: "a", name: "A", displayName: "Aa", username: null, profileImageUrl: null, avatarUrl: null, addedAt: "t",
    }]];
    const { server, base } = await start();
    try {
      const body: any = await (await fetch(`${base}/close-friends`)).json();
      expect(body.friendIds).toEqual(["a"]);
      expect(body.friends[0]).toMatchObject({ userId: "a", name: "Aa", handle: "@aa" });
    } finally { server.close(); }
  });
});
