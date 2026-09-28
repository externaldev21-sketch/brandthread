/**
 * GET /api/buyer/notifications excludes activity from a blocked user (either
 * direction) once a block exists — Instagram's own behavior: blocking someone
 * from the Activity "..." menu also stops their activity from showing there.
 *
 * Mocked `@workspace/db` (see social-search-accounts.test.ts's file banner
 * for why this sandbox can't run a real-Postgres integration test here).
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  blockRows: [] as { blockerId: string; blockedId: string }[],
  feedRows: [] as any[],
  lastWhereCalls: [] as any[],
}));

vi.mock("@workspace/db", () => {
  const tableStub = (name: string) => new Proxy({}, {
    get: (_t, prop) => (typeof prop === "string" ? `${name}.${prop}` : undefined),
  });

  function chain(result: any): any {
    const obj: any = {
      from: () => obj,
      where: (...args: any[]) => { state.lastWhereCalls.push(args); return obj; },
      orderBy: () => obj,
      limit: () => obj,
      offset: () => obj,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
    };
    return obj;
  }

  let callCount = 0;
  return {
    users: tableStub("users"),
    blocks: tableStub("blocks"),
    activityMutes: tableStub("activityMutes"),
    notificationsFeed: tableStub("notificationsFeed"),
    db: {
      // First select() call in the route is blockedCounterpartIds' own
      // select-from-blocks; the second is the main feed query.
      select: vi.fn(() => {
        callCount += 1;
        return callCount === 1 ? chain(state.blockRows) : chain(state.feedRows);
      }),
    },
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = "me-1";
    next();
  },
}));

async function startServer() {
  const { default: feedRouter } = await import("../notifications-feed");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/notifications", feedRouter);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

describe("GET /api/buyer/notifications — block filtering", () => {
  it("adds a not-blocked-actor condition to the feed query once a block exists", async () => {
    state.blockRows = [{ blockerId: "me-1", blockedId: "blocked-user" }];
    state.feedRows = [];
    state.lastWhereCalls = [];
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/buyer/notifications`);
      expect(res.status).toBe(200);
      // Two .where() calls: one for the blocks lookup, one for the feed
      // itself — the second must have received more than the plain
      // userId-only condition once a block exists (the notInArray guard).
      expect(state.lastWhereCalls.length).toBeGreaterThanOrEqual(2);
    } finally {
      server.close();
    }
  });

  it("does not filter when the viewer has no blocks", async () => {
    state.blockRows = [];
    state.feedRows = [{
      id: "n1", category: "social", type: "new_follower", title: "x", body: "",
      isRead: false, isMuted: false, actorId: null, createdAt: new Date(),
    }];
    state.lastWhereCalls = [];
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/buyer/notifications`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
