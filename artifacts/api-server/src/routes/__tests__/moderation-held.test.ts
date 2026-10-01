import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Mocked-db route tests for the held-content queue (run without a database).

const state = vi.hoisted(() => ({
  results: [] as unknown[],
  updates: [] as Array<Record<string, unknown>>,
  released: [] as Array<[string, string, string]>,
  removed: [] as Array<[string, string, string]>,
  releaseOk: true,
  removeOk: true,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = "mod-1"; next(); },
  requireModerator: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@clerk/express", () => ({ clerkClient: { users: {} }, getAuth: () => ({ userId: "mod-1" }) }));

vi.mock("drizzle-orm", () => {
  const f = (...a: unknown[]) => a;
  const sql = Object.assign((...a: unknown[]) => a, {});
  return { and: f, or: f, eq: f, ne: f, gt: f, asc: f, inArray: f, count: f, desc: f, sql };
});

vi.mock("@workspace/db", () => {
  const cols = new Proxy({}, { get: (_t, k) => String(k) });
  const chain = (kind: "select" | "update") => {
    const c: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(state.results.length ? state.results.shift() : []);
        }
        if (prop === "set") return (values: Record<string, unknown>) => { if (kind === "update") state.updates.push(values); return c; };
        return () => c;
      },
    });
    return c;
  };
  return {
    db: { select: () => chain("select"), update: () => chain("update") },
    posts: cols, stories: cols, postComments: cols, reports: cols, mediaModerationResults: cols, users: cols,
  };
});

vi.mock("../../lib/safety", () => ({
  profilesById: async (ids: string[]) => new Map(ids.map((id) => [id, { userId: id, name: `User ${id}`, handle: "", initials: "U", avatarUrl: null, accountType: "buyer", suspended: false, deleted: false }])),
}));
vi.mock("../../lib/reportTargets", () => ({
  releaseHeldContent: async (t: string, id: string, m: string) => { state.released.push([t, id, m]); return state.releaseOk; },
  removeReportedContent: async (t: string, id: string, m: string) => { state.removed.push([t, id, m]); return state.removeOk; },
}));

const POST_ID = "11111111-1111-4111-8111-111111111111";
const STORY_ID = "22222222-2222-4222-8222-222222222222";
let server: Server;
let base = "";

beforeAll(async () => {
  const { default: router, encodeCursor, decodeCursor } = await import("../moderationHeld");
  expect(decodeCursor(encodeCursor(new Date("2026-01-01T00:00:00Z"), POST_ID))?.id).toBe(POST_ID);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; (req as any).clerkUserId = "mod-1"; next(); });
  app.use("/held", router);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  state.results = []; state.updates = []; state.released = []; state.removed = [];
  state.releaseOk = true; state.removeOk = true;
});

const call = async (path: string, method = "GET") => {
  const res = await fetch(`${base}${path}`, { method });
  return { status: res.status, body: await res.json().catch(() => null) as any };
};

describe("GET /held", () => {
  it("lists held posts oldest first with author and media verdict", async () => {
    state.results = [
      [{ id: POST_ID, userId: "u1", caption: "hi", mediaType: "photo", mediaUrl: "https://x/a.jpg", mediaUrls: ["https://x/a.jpg"], thumbnailUrl: null, reason: "media:sexual", createdAt: new Date("2026-01-01T00:00:00Z") }],
      [{ targetType: "post", targetId: POST_ID, verdict: "hold", categories: ["sexual"], scores: { sexual: 0.7 }, maxScore: 0.7, framesChecked: 1, priority: "normal", provider: "openai", createdAt: new Date() }],
    ];
    const { status, body } = await call("/held?type=post");
    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      type: "post", id: POST_ID, author: { name: "User u1" },
      mediaUrls: ["https://x/a.jpg"],
      moderation: { verdict: "hold", categories: ["sexual"], maxScore: 0.7 },
    });
    expect(body.hasMore).toBe(false);
  });

  it("type=media only returns items that have a screening result", async () => {
    state.results = [
      [{ id: POST_ID, userId: "u1", caption: "", mediaType: "photo", mediaUrl: "https://x/a.jpg", mediaUrls: [], thumbnailUrl: null, reason: null, createdAt: new Date("2026-01-01T00:00:00Z") }],
      [{ id: STORY_ID, authorId: "u2", media: [{ uri: "https://x/s.jpg" }], moderationReason: null, createdAt: new Date("2026-01-02T00:00:00Z") }],
      [{ targetType: "story", targetId: STORY_ID, verdict: "hold", categories: [], scores: {}, maxScore: 0, framesChecked: 0, priority: "normal", provider: "x", createdAt: new Date() }],
    ];
    const { body } = await call("/held?type=media");
    expect(body.items.map((i: any) => i.id)).toEqual([STORY_ID]);
    expect(body.items[0].mediaUrls).toEqual(["https://x/s.jpg"]);
  });

  it("rejects bad type and bad cursor", async () => {
    expect((await call("/held?type=nope")).status).toBe(400);
    expect((await call("/held?cursor=zzz")).status).toBe(400);
  });
});

describe("GET /held/counts", () => {
  it("returns badge counts", async () => {
    state.results = [[{ n: 2 }], [{ n: 1 }], [{ n: 3 }], [{ n: 1 }]];
    const { body } = await call("/held/counts");
    expect(body).toEqual({ total: 6, posts: 2, stories: 1, comments: 3, highPriorityUnreviewed: 1 });
  });
});

describe("approve / remove", () => {
  it("approves a held story and records the reviewer", async () => {
    const { status, body } = await call(`/held/story/${STORY_ID}/approve`, "POST");
    expect(status).toBe(200);
    expect(state.released).toEqual([["story", STORY_ID, "mod-1"]]);
    expect(body).toMatchObject({ ok: true, action: "approve", reviewedBy: "mod-1" });
    expect(state.updates.some((u) => u.reviewedBy === "mod-1" && u.reviewAction === "approve")).toBe(true);
    expect(state.updates.some((u) => u.status === "dismissed" && u.resolvedBy === "mod-1")).toBe(true);
  });

  it("409s when the item is no longer held", async () => {
    state.releaseOk = false;
    expect((await call(`/held/post/${POST_ID}/approve`, "POST")).status).toBe(409);
  });

  it("removes a held post only when it is still held", async () => {
    state.results = [[{ id: POST_ID }]];
    const ok = await call(`/held/post/${POST_ID}/remove`, "POST");
    expect(ok.status).toBe(200);
    expect(state.removed).toEqual([["post", POST_ID, "mod-1"]]);
    state.results = [[]];
    expect((await call(`/held/post/${POST_ID}/remove`, "POST")).status).toBe(409);
  });

  it("validates type and id", async () => {
    expect((await call(`/held/product/${POST_ID}/approve`, "POST")).status).toBe(400);
    expect((await call(`/held/post/not-a-uuid/remove`, "POST")).status).toBe(404);
  });
});
