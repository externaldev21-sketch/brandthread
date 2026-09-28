/**
 * GET /api/buyer/notifications — live follow state on new-follower rows.
 *
 * The stored `cta: "Follow back"` is written once, at follow time, so the
 * feed adds `isFollowingActor` (does the viewer follow this follower right
 * now?) for the Activity row's inline Follow back / Following pill.
 *
 * Mocked `@workspace/db` (see social-search-accounts.test.ts's file banner
 * for why this sandbox can't run a real-Postgres integration test here).
 * Each select() resolves to the rows seeded for the table it reads `from`.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  reads: {} as Record<string, number>,
}));

vi.mock("@workspace/db", () => {
  const tableStub = (name: string) => new Proxy({ __name: name } as Record<string, unknown>, {
    get: (t, prop) => (prop === "__name" ? t.__name : typeof prop === "string" ? `${name}.${prop}` : undefined),
  });

  function chain(): any {
    let table = "";
    const obj: any = {
      from: (t: any) => { table = t.__name; state.reads[table] = (state.reads[table] ?? 0) + 1; return obj; },
      where: () => obj,
      orderBy: () => obj,
      limit: () => obj,
      offset: () => obj,
      then: (resolve: any, reject: any) => Promise.resolve(state.rows[table] ?? []).then(resolve, reject),
    };
    return obj;
  }

  return {
    users: tableStub("users"),
    blocks: tableStub("blocks"),
    follows: tableStub("follows"),
    activityMutes: tableStub("activityMutes"),
    notificationsFeed: tableStub("notificationsFeed"),
    db: { select: vi.fn(() => chain()) },
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

const row = (id: string, type: string, actorId: string | null, extra: Record<string, unknown> = {}) => ({
  id, userId: "me-1", category: "social", type, title: "x", body: "", isRead: false, isMuted: false,
  actorId, actorName: actorId, targetId: actorId, targetType: "user", createdAt: new Date(), ...extra,
});

describe("GET /api/buyer/notifications — isFollowingActor", () => {
  it("marks each follow row with whether the viewer follows that person now", async () => {
    state.rows = {
      blocks: [],
      notificationsFeed: [
        row("n1", "new_follower", "u-followed", { cta: "Follow back" }),
        row("n2", "new_follower", "u-not-followed", { cta: "Follow back" }),
        row("n3", "post_like", "u-followed"),
      ],
      follows: [{ followingId: "u-followed" }],
    };
    state.reads = {};
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/buyer/notifications?limit=30&offset=0`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any[];
      expect(body.find((r) => r.id === "n1")).toMatchObject({ isFollowingActor: true, cta: "Follow back" });
      expect(body.find((r) => r.id === "n2")).toMatchObject({ isFollowingActor: false });
      // Only follow rows carry it.
      expect(body.find((r) => r.id === "n3")).not.toHaveProperty("isFollowingActor");
    } finally {
      server.close();
    }
  });

  it("skips the follows lookup when the page has no follow rows", async () => {
    state.rows = { blocks: [], notificationsFeed: [row("n1", "post_like", "u-a")] };
    state.reads = {};
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/buyer/notifications`);
      expect(res.status).toBe(200);
      expect(state.reads.follows ?? 0).toBe(0);
    } finally {
      server.close();
    }
  });
});
