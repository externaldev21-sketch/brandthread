/**
 * POST /api/social/follow against a private target (-> 202 requested, deduped,
 * notification once), DELETE cancelling a request, GET /status 'requested', and
 * the private -> public toggle (auto-approve) in applyPrivateAccountToggle.
 * Scripted `@workspace/db` mock — no Postgres in this sandbox.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const s = vi.hoisted(() => ({
  selects: [] as any[][],
  txSelects: [] as any[][],
  txInserts: [] as any[][],
  inserted: [] as Array<{ table: string; values: any }>,
  deleted: [] as string[],
  executed: [] as string[],
  updates: [] as any[],
  notifications: [] as any[],
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({}, {
    get: (_t, p) => (p === "__name" ? name : typeof p === "string" ? `${name}.${p}` : undefined),
  });
  const named = (name: string) => Object.assign(table(name), {});
  const chain = (next: () => any[]): any => {
    const c: any = {};
    for (const m of ["from", "where", "innerJoin", "orderBy", "limit", "offset", "onConflictDoNothing"]) c[m] = () => c;
    c.set = (v: any) => { s.updates.push(v); return c; };
    c.returning = () => Promise.resolve(next());
    c.then = (res: any, rej: any) => Promise.resolve(next()).then(res, rej);
    return c;
  };
  const tx = {
    execute: vi.fn(async (q: any) => { s.executed.push(q.queryChunks.map((c: any) => (typeof c === "object" && c.value ? c.value.join("") : "")).join("")); return { rows: [] }; }),
    delete: vi.fn((t: any) => { s.deleted.push(String(t.id ?? t)); return chain(() => []); }),
    insert: vi.fn((t: any) => ({
      values: (v: any) => { s.inserted.push({ table: t.__tag, values: v }); return chain(() => s.txInserts.shift() ?? []); },
    })),
    select: vi.fn(() => chain(() => s.txSelects.shift() ?? [])),
    update: vi.fn(() => chain(() => [{ dmPrivacy: "requests", isPrivate: false }])),
  };
  const tag = (name: string) => { const t: any = named(name); return new Proxy(t, { get: (x, p) => (p === "__tag" ? name : x[p]) }); };
  return {
    db: {
      select: vi.fn(() => chain(() => s.selects.shift() ?? [])),
      transaction: vi.fn(async (cb: any) => cb(tx)),
      delete: vi.fn(() => chain(() => [])),
    },
    users: tag("users"), follows: tag("follows"), followRequests: tag("follow_requests"), closeFriends: tag("close_friends"),
    blocks: tag("blocks"), notificationsFeed: tag("notifications_feed"), stories: tag("stories"), storyMentions: tag("sm"),
    storyLikes: tag("sl"), storyViews: tag("sv"), notes: tag("notes"), posts: tag("posts"), postUserTags: tag("put"),
    interactions: tag("i"), suggestionDismissals: tag("sd"), activityMutes: tag("am"),
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = req.header("x-test-user-id") || "me-1"; next(); },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _r: any, next: () => void) => next() }));
vi.mock("../notifications-feed", () => ({ publishNotification: async (n: any) => { s.notifications.push(n); } }));
vi.mock("../../lib/safety", () => ({
  authorInGoodStanding: () => undefined, blockRelation: async () => "none", mutedPhrasesFor: async () => [],
  notBlockedWith: () => undefined, publishingRestriction: async () => null,
  profilesById: async (ids: string[]) => new Map(ids.map((id) => [id, {
    userId: id, name: "Me", handle: "@me", initials: "ME", deleted: false, suspended: false,
  }])),
}));
vi.mock("../../lib/conversationRouting", () => ({ promotePendingRequestsOnFollow: async () => undefined }));
vi.mock("../public", () => ({ resolveToClerkId: async (id: string) => id }));

async function start() {
  const { default: router } = await import("../social");
  const app = express();
  app.use(express.json());
  app.use("/api/social", router);
  const server: Server = await new Promise((r) => { const x = app.listen(0, "127.0.0.1", () => r(x)); });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/social` };
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/follow`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  s.selects = []; s.txSelects = []; s.txInserts = []; s.inserted = []; s.deleted = [];
  s.executed = []; s.updates = []; s.notifications = [];
});

describe("POST /api/social/follow on a private account", () => {
  it("creates a follow request (202 requested), not a follow, and notifies once", async () => {
    s.selects = [[{ clerkId: "priv-1", isPrivate: true }]];
    s.txSelects = [[], []]; // no block; not already following
    s.txInserts = [[{ requesterId: "me-1", targetId: "priv-1" }]];
    const { server, base } = await start();
    try {
      const res = await post(base, { userId: "priv-1" });
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ ok: true, isFollowing: false, status: "requested" });
      expect(s.inserted.map((i) => i.table)).toEqual(["follow_requests"]);
      await new Promise((r) => setTimeout(r, 10));
      expect(s.notifications).toHaveLength(1);
      expect(s.notifications[0]).toMatchObject({ userId: "priv-1", type: "follow_request" });
    } finally { server.close(); }
  });

  it("a repeated request is deduped: still 202 but no second notification", async () => {
    s.selects = [[{ clerkId: "priv-1", isPrivate: true }]];
    s.txSelects = [[], []];
    s.txInserts = [[]]; // conflict -> nothing returned
    const { server, base } = await start();
    try {
      const res = await post(base, { userId: "priv-1" });
      expect(res.status).toBe(202);
      await new Promise((r) => setTimeout(r, 10));
      expect(s.notifications).toEqual([]);
    } finally { server.close(); }
  });

  it("an existing follower of a private account keeps following (200, follows path)", async () => {
    s.selects = [[{ clerkId: "priv-1", isPrivate: true }], []];
    s.txSelects = [[], [{ f: "me-1" }], [{ n: 4 }]]; // no block; already following; count
    s.txInserts = [[]];
    const { server, base } = await start();
    try {
      const res = await post(base, { userId: "priv-1" });
      expect(res.status).toBe(200);
      expect(s.inserted.map((i) => i.table)).toEqual(["follows"]);
    } finally { server.close(); }
  });

  it("a public target still follows immediately", async () => {
    s.selects = [[{ clerkId: "pub-1", isPrivate: false }], []];
    s.txSelects = [[], [{ n: 1 }]];
    s.txInserts = [[{ followerId: "me-1", followingId: "pub-1" }]];
    const { server, base } = await start();
    try {
      const res = await post(base, { userId: "pub-1" });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ isFollowing: true });
      expect(s.inserted.map((i) => i.table)).toEqual(["follows"]);
    } finally { server.close(); }
  });

  it("DELETE /follow/:id also cancels a pending request", async () => {
    s.txSelects = [[{ n: 0 }]];
    const { server, base } = await start();
    try {
      const res = await fetch(`${base}/follow/priv-1`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(s.deleted.length).toBeGreaterThanOrEqual(3); // follows, follow_requests, notifications
    } finally { server.close(); }
  });

  it("GET /status reports 'requested'", async () => {
    // following? no, followed-by? no, then request row, then private flag
    s.selects = [[{ n: 0 }], [{ n: 0 }], [{ r: "me-1" }], [{ p: true }], [{ n: 2 }]];
    const { server, base } = await start();
    try {
      const body = await (await fetch(`${base}/status/priv-1`)).json();
      expect(body).toMatchObject({ isFollowing: false, status: "requested", isPrivate: true });
    } finally { server.close(); }
  });
});

describe("applyPrivateAccountToggle", () => {
  it("private -> public auto-approves pending requests and clears the queue in one transaction", async () => {
    const { applyPrivateAccountToggle } = await import("../../lib/privateAccount");
    s.selects = [[{ accountType: "buyer", isPrivate: true }]];
    const updates: Record<string, any> = {};
    const out = await applyPrivateAccountToggle("me-1", false, updates);
    expect(out.status).toBe("opened");
    expect(s.executed[0]).toContain("INSERT INTO follows");
    expect(s.executed[0]).toContain("FROM follow_requests");
    expect(s.executed[1]).toContain("DELETE FROM follow_requests");
    expect(updates.isPrivate).toBe(false);
  });

  it("public -> private is a plain update and leaves existing followers alone", async () => {
    const { applyPrivateAccountToggle } = await import("../../lib/privateAccount");
    s.selects = [[{ accountType: "buyer", isPrivate: false }]];
    const updates: Record<string, any> = {};
    expect((await applyPrivateAccountToggle("me-1", true, updates)).status).toBe("applied");
    expect(updates.isPrivate).toBe(true);
    expect(s.executed).toEqual([]);
  });

  it("sellers (and 'both') cannot turn private on", async () => {
    const { applyPrivateAccountToggle } = await import("../../lib/privateAccount");
    s.selects = [[{ accountType: "seller", isPrivate: false }], [{ accountType: "both", isPrivate: false }]];
    expect((await applyPrivateAccountToggle("s-1", true, {})).status).toBe("forbidden");
    expect((await applyPrivateAccountToggle("b-1", true, {})).status).toBe("forbidden");
  });
});
