/**
 * GET /api/buyer/notifications/actors?ids= — the people behind one merged
 * Activity row ("Jay and 12 others liked your post"), opened as a pushed
 * people list from the Activity tab.
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
  whereCalls: {} as Record<string, number>,
}));

vi.mock("@workspace/db", () => {
  const tableStub = (name: string) => new Proxy({ __name: name } as Record<string, unknown>, {
    get: (t, prop) => (prop === "__name" ? t.__name : typeof prop === "string" ? `${name}.${prop}` : undefined),
  });

  function chain(): any {
    let table = "";
    const obj: any = {
      from: (t: any) => { table = t.__name; return obj; },
      where: () => { state.whereCalls[table] = (state.whereCalls[table] ?? 0) + 1; return obj; },
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

const like = (id: string, actorId: string | null, name: string, minutesAgo: number) => ({
  id, userId: "me-1", category: "social", type: "post_like", title: `${name} liked your post`, body: "",
  isRead: true, isMuted: false, actorId, actorName: name, actorHandle: `@${name.toLowerCase()}`,
  actorInitials: name.slice(0, 2).toUpperCase(), actorColor: "#3F3F46",
  targetId: "post-1", targetType: "post", createdAt: new Date(Date.now() - minutesAgo * 60_000),
});

describe("GET /api/buyer/notifications/actors", () => {
  it("rejects a request with no ids", async () => {
    state.rows = {};
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/buyer/notifications/actors`);
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("returns distinct actors newest first with the viewer's follow state", async () => {
    state.rows = {
      blocks: [],
      notificationsFeed: [
        like("n1", "u-jay", "Jay", 1),
        like("n2", "u-mina", "Mina", 5),
        like("n3", "u-jay", "Jay", 9), // repeat actor collapses
        like("n4", null, "System", 12), // no actor → not a person
      ],
      users: [{ clerkId: "u-mina", profileImageUrl: "https://img.test/mina.jpg", avatarUrl: null }],
      follows: [{ followingId: "u-mina" }],
    };
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/buyer/notifications/actors?ids=n1,n2,n3,n4`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { actors: any[] };
      expect(body.actors.map((a: any) => a.id)).toEqual(["u-jay", "u-mina"]);
      expect(body.actors[0]).toMatchObject({ name: "Jay", handle: "@jay", isFollowing: false });
      expect(body.actors[1]).toMatchObject({ name: "Mina", isFollowing: true, avatarUrl: "https://img.test/mina.jpg" });
    } finally {
      server.close();
    }
  });

  it("skips the follows lookup when no row has an actor", async () => {
    state.rows = { blocks: [], notificationsFeed: [like("n1", null, "System", 1)] };
    state.whereCalls = {};
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/buyer/notifications/actors?ids=n1`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { actors: unknown[] }).actors).toEqual([]);
      expect(state.whereCalls.follows ?? 0).toBe(0);
    } finally {
      server.close();
    }
  });
});
