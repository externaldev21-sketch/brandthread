/**
 * GET    /api/social/me/liked-posts
 * DELETE /api/social/notes/me
 * GET    /api/social/follow-back-dismissals
 * POST   /api/social/follow-back-dismissals/:userId
 *
 * Same constraint as social-follower-management.test.ts: no disposable
 * Postgres in this sandbox, so the real express app and route handlers run
 * against a stubbed `db`. Real drizzle tables are kept so the WHERE clauses
 * the routes build can be rendered to SQL and checked for the visibility
 * filters (likes only, blocks, "Not interested", cursor).
 */
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  selectResults: [] as any[][],
  wheres: [] as any[],
  limits: [] as number[],
  inserted: [] as Array<{ table: any; values: any }>,
  deleted: [] as Array<{ table: any; where: any }>,
  allowedAuthors: new Set<string>(),
  mutedPhrases: [] as string[],
}));

vi.mock("@workspace/db", async () => {
  // The schema entry point has no connection side effects (the package root
  // throws without DATABASE_URL), so the real tables come from there.
  const actual = await import("@workspace/db/schema");
  function chain(): any {
    const obj: any = {
      from: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      where: (w: any) => { state.wheres.push(w); return obj; },
      orderBy: () => obj,
      limit: (n: number) => { state.limits.push(n); return obj; },
      offset: () => obj,
      then: (resolve: any, reject: any) => Promise.resolve(state.selectResults.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return {
    ...actual,
    db: {
      select: vi.fn(() => chain()),
      insert: vi.fn((table: any) => {
        const obj: any = {
          values: (values: any) => { state.inserted.push({ table, values }); return obj; },
          onConflictDoNothing: () => Promise.resolve([]),
        };
        return obj;
      }),
      delete: vi.fn((table: any) => ({
        where: (where: any) => { state.deleted.push({ table, where }); return Promise.resolve([]); },
      })),
    },
  };
});

vi.mock("../../lib/privacySettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/privacySettings")>(),
  ownersAllowing: vi.fn(async () => state.allowedAuthors),
}));

vi.mock("../../lib/safety", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/safety")>(),
  mutedPhrasesFor: vi.fn(async () => state.mutedPhrases),
  profilesById: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { userId: id, name: `Name ${id}` }]))),
}));

vi.mock("../public", async (importOriginal) => ({
  ...await importOriginal<typeof import("../public")>(),
  resolveToClerkId: vi.fn(async (id: string) => (id === "uuid-alias-of-me" ? "me-1" : id)),
}));

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

const dialect = new PgDialect();
const render = (where: any) => dialect.sqlToQuery(where);

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

function likeRow(n: number, overrides: Record<string, unknown> = {}) {
  return {
    likeId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    likedAt: new Date(Date.UTC(2026, 9, 20, 12, 0, 60 - n)),
    id: `post-${n}`,
    userId: "author-a",
    mediaType: "photo",
    mediaUrl: `https://cdn.test/p${n}.jpg`,
    mediaUrls: [] as string[],
    thumbnailUrl: null as string | null,
    slides: [] as any[],
    caption: `caption ${n}`,
    styleTags: [] as string[],
    ...overrides,
  };
}

// Cold-loading the social router graph can exceed the 5s per-test deadline.
beforeAll(async () => { await import("../social"); });

beforeEach(() => {
  state.selectResults = [];
  state.wheres = [];
  state.limits = [];
  state.inserted = [];
  state.deleted = [];
  state.allowedAuthors = new Set(["author-a", "author-b"]);
  state.mutedPhrases = [];
});

describe("liked-posts helpers", () => {
  it("round-trips the (likedAt, likeId) cursor and rejects junk", async () => {
    const { encodeLikedCursor, decodeLikedCursor } = await import("../social");
    const at = new Date("2026-10-20T12:00:00.123Z");
    const id = "11111111-2222-4333-8444-555555555555";
    expect(decodeLikedCursor(encodeLikedCursor(at, id))).toEqual({ likedAt: at, likeId: id });
    expect(decodeLikedCursor("not-a-cursor")).toBeNull();
    expect(decodeLikedCursor(Buffer.from("2026-10-20T12:00:00Z|x'; drop").toString("base64url"))).toBeNull();
  });

  it("maps carousel, slideshow and video media to the LikedPost shape", async () => {
    const { likedPostMedia } = await import("../social");
    expect(likedPostMedia({
      mediaType: "slideshow", mediaUrl: "a.jpg", mediaUrls: ["a.jpg", "b.jpg"], thumbnailUrl: null, slides: [],
    })).toEqual({ thumbnailUri: "a.jpg", mediaUris: ["a.jpg", "b.jpg"], mediaType: "image" });
    expect(likedPostMedia({
      mediaType: "photo", mediaUrl: "", mediaUrls: [], thumbnailUrl: null,
      slides: [{ kind: "video", url: "s1.mp4", thumbnailUrl: "s1.jpg" }, { kind: "photo", url: "s2.jpg", thumbnailUrl: "" }],
    })).toEqual({ thumbnailUri: "s1.jpg", mediaUris: ["s1.mp4", "s2.jpg"], mediaType: "image" });
    expect(likedPostMedia({
      mediaType: "video", mediaUrl: "v.mp4", mediaUrls: [], thumbnailUrl: null, slides: [],
    })).toEqual({ thumbnailUri: null, mediaUris: ["v.mp4"], mediaType: "video" });
  });
});

describe("GET /api/social/me/liked-posts", () => {
  it("returns my likes newest first with the visibility filters in SQL and a next cursor", async () => {
    state.selectResults = [[likeRow(1), likeRow(2), likeRow(3)]];
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/me/liked-posts?limit=2`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.posts.map((p: any) => p.id)).toEqual(["post-1", "post-2"]);
      expect(body.posts[0]).toEqual({
        id: "post-1",
        thumbnailUri: "https://cdn.test/p1.jpg",
        mediaUris: ["https://cdn.test/p1.jpg"],
        mediaType: "image",
        caption: "caption 1",
        authorId: "author-a",
        authorName: "Name author-a",
        likedAt: likeRow(1).likedAt.toISOString(),
      });
      expect(typeof body.nextCursor).toBe("string");
      expect(state.limits[0]).toBe(3);

      const { sql, params } = render(state.wheres[0]);
      expect(sql).toContain('"interactions"."user_id"');
      expect(sql).toContain('"interactions"."type"');
      expect(params).toEqual(expect.arrayContaining(["me-1", "like", "visible"]));
      expect(sql).toContain("blocks");
      expect(sql).toContain("feed_not_interested");

      // Following the cursor adds the keyset condition on (created_at, id).
      state.selectResults = [[likeRow(3)]];
      const next = await fetch(`${base}/api/social/me/liked-posts?limit=2&cursor=${encodeURIComponent(body.nextCursor)}`);
      expect(next.status).toBe(200);
      const nextBody: any = await next.json();
      expect(nextBody.posts.map((p: any) => p.id)).toEqual(["post-3"]);
      expect(nextBody.nextCursor).toBeNull();
      const second = render(state.wheres[state.wheres.length - 1]);
      expect(second.sql).toContain('"interactions"."created_at" <');
      expect(second.params).toEqual(expect.arrayContaining([likeRow(2).likeId]));
    } finally {
      server.close();
    }
  });

  it("drops posts whose author limits who can see posts, and muted-word captions", async () => {
    state.allowedAuthors = new Set(["author-a"]);
    state.mutedPhrases = ["spoiler"];
    state.selectResults = [[
      likeRow(1),
      likeRow(2, { userId: "author-hidden" }),
      likeRow(3, { caption: "big spoiler here" }),
      likeRow(4, { userId: "me-1", caption: "my own spoiler" }),
    ]];
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/me/liked-posts`);
      const body: any = await res.json();
      expect(body.posts.map((p: any) => p.id)).toEqual(["post-1", "post-4"]);
      expect(body.nextCursor).toBeNull();
    } finally {
      server.close();
    }
  });

  it("rejects a malformed cursor", async () => {
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/me/liked-posts?cursor=garbage`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    } finally {
      server.close();
    }
  });
});

describe("DELETE /api/social/notes/me", () => {
  it("deletes only the caller's note and is idempotent", async () => {
    const { server, base } = await startServer();
    try {
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${base}/api/social/notes/me`, { method: "DELETE" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      }
      expect(state.deleted).toHaveLength(2);
      const { sql, params } = render(state.deleted[0].where);
      expect(sql).toBe('"notes"."author_id" = $1');
      expect(params).toEqual(["me-1"]);
    } finally {
      server.close();
    }
  });
});

describe("follow-back dismissals", () => {
  it("lists the dismissed user ids for the caller", async () => {
    state.selectResults = [[{ userId: "u-2" }, { userId: "u-1" }]];
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/follow-back-dismissals`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ userIds: ["u-2", "u-1"] });
      const { params } = render(state.wheres[0]);
      expect(params).toEqual(["me-1"]);
    } finally {
      server.close();
    }
  });

  it("persists a dismissal (idempotent insert) and refuses dismissing yourself", async () => {
    const { server, base } = await startServer();
    try {
      const res = await fetch(`${base}/api/social/follow-back-dismissals/u-9`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(state.inserted.map((row) => row.values)).toEqual([{ userId: "me-1", dismissedUserId: "u-9" }]);

      const self = await fetch(`${base}/api/social/follow-back-dismissals/uuid-alias-of-me`, { method: "POST" });
      expect(self.status).toBe(400);
      expect(state.inserted).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
