/**
 * DELETE /api/social/followers/:userId (remove a follower) and
 * POST /api/social/see-less (mute a notification type or actor).
 *
 * This sandbox has no reachable Postgres superuser for provisioning a
 * disposable integration-test database (same documented constraint as
 * social-search-accounts.test.ts) — this asserts against a fully mocked
 * `@workspace/db` instead of a real one: a real express() app and the real
 * route handlers run, only the table reads/writes are stubbed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  followRows: [{ followerId: "target-1", followingId: "me-1" }] as any[],
  followerCount: 3,
  insertedMutes: [] as any[],
  updatedMuteFilters: [] as any[],
  deletedNotifications: [] as any[],
}));

vi.mock("@workspace/db", () => {
  const tableStub = (name: string) => new Proxy({}, {
    get: (_t, prop) => (typeof prop === "string" ? `${name}.${prop}` : undefined),
  });

  // A minimal thenable query-builder stand-in: every chain method returns
  // itself so call sites can chain in any order the real route code uses,
  // and awaiting it resolves to whatever `result` was seeded with.
  function chain(result: any): any {
    const obj: any = {
      from: () => obj,
      where: () => obj,
      values: () => obj,
      set: () => obj,
      onConflictDoNothing: () => obj,
      orderBy: () => obj,
      limit: () => obj,
      offset: () => obj,
      returning: () => Promise.resolve(result),
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return obj;
  }

  const txStub = {
    execute: vi.fn(async () => ({ rows: [] })),
    // The route's only tx.delete calls here are on `follows` (returns the
    // seeded follow row on the first call) and `notificationsFeed` (side
    // effect, result unused) — a single stand-in covers both call shapes.
    delete: vi.fn(() => chain(state.followRows.splice(0, state.followRows.length))),
    select: vi.fn(() => chain([{ n: state.followerCount }])),
  };

  return {
    users: tableStub("users"),
    follows: tableStub("follows"),
    stories: tableStub("stories"),
    storyLikes: tableStub("storyLikes"),
    storyViews: tableStub("storyViews"),
    blocks: tableStub("blocks"),
    posts: tableStub("posts"),
    interactions: tableStub("interactions"),
    notificationsFeed: tableStub("notificationsFeed"),
    suggestionDismissals: tableStub("suggestionDismissals"),
    activityMutes: tableStub("activityMutes"),
    db: {
      transaction: vi.fn(async (cb: any) => cb(txStub)),
      insert: vi.fn((table: any) => {
        const obj: any = {
          values: (v: any) => {
            state.insertedMutes.push(v);
            return obj;
          },
          onConflictDoNothing: () => Promise.resolve([]),
        };
        return obj;
      }),
      update: vi.fn((table: any) => ({
        set: (v: any) => ({
          where: (w: any) => {
            state.updatedMuteFilters.push(w);
            return Promise.resolve();
          },
        }),
      })),
      select: vi.fn(() => chain([])),
    },
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || "me-1";
    next();
  },
}));

vi.mock("../notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));

async function startServer() {
  const { default: socialRouter } = await import("../social");
  const app = express();
  app.use(express.json());
  app.use("/api/social", socialRouter);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

beforeEach(() => {
  state.followRows = [{ followerId: "target-1", followingId: "me-1" }];
  state.insertedMutes = [];
  state.updatedMuteFilters = [];
});

describe("DELETE /api/social/followers/:userId", () => {
  it("removes the follow edge in the them-following-me direction and returns the new followers count", async () => {
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/followers/target-1`, { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, removed: true, followersCount: 3 });
    } finally {
      server.close();
    }
  });

  it("rejects removing yourself as your own follower", async () => {
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/followers/me-1`, { method: "DELETE" });
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });
});

describe("POST /api/social/see-less", () => {
  it("requires exactly one of type or actorId", async () => {
    const { server, base } = await startServer();
    try {
      const neither = await fetch(`${base}/api/social/see-less`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(neither.status).toBe(400);

      const both = await fetch(`${base}/api/social/see-less`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "new_follower", actorId: "u1" }),
      });
      expect(both.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("persists a type mute and hides already-published rows of that type", async () => {
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/see-less`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "new_follower" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, muteKey: "type:new_follower" });
      expect(state.insertedMutes).toEqual([{ userId: "me-1", muteKey: "type:new_follower" }]);
      expect(state.updatedMuteFilters).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it("persists an actor mute using a distinct key from a type mute", async () => {
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/see-less`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actorId: "u1" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, muteKey: "actor:u1" });
    } finally {
      server.close();
    }
  });
});
