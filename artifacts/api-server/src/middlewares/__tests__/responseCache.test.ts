import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const auth = vi.hoisted(() => ({ userId: null as string | null }));
const blocks = vi.hoisted(() => ({ users: new Set<string>(), queries: 0 }));

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: auth.userId }) }));
vi.mock("@workspace/db", () => ({
  db: {
    execute: async () => { blocks.queries++; return { rows: auth.userId && blocks.users.has(auth.userId) ? [{ "?column?": 1 }] : [] }; },
  },
}));

import { MemoryStore, __setCacheStoreForTests } from "../../lib/cacheStore";
import { bumpResponseCacheGeneration, cacheKeyFor, forgetViewerBlocksMemo, invalidateResponseCache, responseCache } from "../responseCache";

let server: Server;
let base = "";
let hits = 0;
let delayMs = 0;
let status = 200;

async function start() {
  const app = express();
  app.get("/search", responseCache({ name: "search", ttlSeconds: 30, scope: "viewer-blocks" }), async (req, res) => {
    hits++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(status).json({ q: req.query.q ?? null, n: hits, viewer: auth.userId });
  });
  app.get("/gen-search", responseCache({ name: "gsearch", ttlSeconds: 30, scope: "viewer-blocks", generational: true }), (req, res) => {
    hits++;
    res.json({ q: req.query.q ?? null, n: hits, viewer: auth.userId });
  });
  app.get("/product/:id", responseCache({ name: "product", ttlSeconds: 15, scope: "anon", idKey: (r) => String(r.params.id) }), (req, res) => {
    hits++;
    res.json({ id: req.params.id, n: hits });
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = async (path: string) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, cache: r.headers.get("x-cache"), cc: r.headers.get("cache-control"), body: await r.json() as any };
};

beforeEach(() => { hits = 0; delayMs = 0; status = 200; auth.userId = null; blocks.users.clear(); blocks.queries = 0; });
afterEach(() => { server?.close(); __setCacheStoreForTests(undefined); });

describe("responseCache with no store (REDIS_URL unset)", () => {
  it("is a pass-through: every request reaches the handler and no cache header is set", async () => {
    __setCacheStoreForTests(null);
    await start();
    const a = await get("/search?q=a");
    const b = await get("/search?q=a");
    expect(hits).toBe(2);
    expect(a.cache).toBeNull();
    expect(b.body.n).toBe(2);
  });
});

describe("responseCache with a store", () => {
  beforeEach(async () => { __setCacheStoreForTests(new MemoryStore()); await start(); });

  it("serves the second identical request from cache, with the handler's Cache-Control", async () => {
    const a = await get("/search?q=hood");
    const b = await get("/search?q=hood");
    expect([a.cache, b.cache]).toEqual(["MISS", "HIT"]);
    expect(hits).toBe(1);
    expect(b.body).toEqual(a.body);
    expect(b.cc).toBe("public, max-age=30");
  });

  it("treats query parameter order as the same key but different values as different keys", async () => {
    await get("/search?q=a&sort=x");
    expect((await get("/search?sort=x&q=a")).cache).toBe("HIT");
    expect((await get("/search?q=b&sort=x")).cache).toBe("MISS");
  });

  it("does not cache non-200 responses", async () => {
    status = 500;
    await get("/search?q=err");
    status = 200;
    const again = await get("/search?q=err");
    expect(again.cache).toBe("MISS");
    expect(hits).toBe(2);
  });

  it("coalesces concurrent misses into one handler run", async () => {
    delayMs = 80;
    const results = await Promise.all(Array.from({ length: 8 }, () => get("/search?q=burst")));
    expect(hits).toBe(1);
    expect(results.filter((r) => r.cache === "MISS")).toHaveLength(1);
    expect(results.filter((r) => r.cache === "COALESCED")).toHaveLength(7);
    expect(new Set(results.map((r) => r.body.n)).size).toBe(1);
  });

  it("shares one entry between anonymous callers and viewers with no blocks", async () => {
    await get("/search?q=shared");
    auth.userId = "viewer_clean";
    const r = await get("/search?q=shared");
    expect(r.cache).toBe("HIT");
    expect(hits).toBe(1);
  });

  it("gives a viewer who has blocks a private entry, never the shared one", async () => {
    await get("/search?q=blocked"); // anonymous warms the shared entry
    blocks.users.add("viewer_blocker");
    auth.userId = "viewer_blocker";
    const mine = await get("/search?q=blocked");
    expect(mine.cache).toBe("MISS");
    expect(mine.body.viewer).toBe("viewer_blocker");
    expect((await get("/search?q=blocked")).cache).toBe("HIT");
    auth.userId = null;
    expect((await get("/search?q=blocked")).body.viewer).toBeNull();
  });

  it("a fresh block is honored on the next request once the memo is forgotten", async () => {
    auth.userId = "viewer_new_blocker";
    await get("/search?q=fresh"); // memo says "no blocks": served the shared entry
    blocks.users.add("viewer_new_blocker");
    expect((await get("/search?q=fresh")).cache).toBe("HIT"); // stale memo, still shared
    await forgetViewerBlocksMemo("viewer_new_blocker", "someone_else");
    const after = await get("/search?q=fresh");
    expect(after.cache).toBe("MISS");
    expect(after.body.viewer).toBe("viewer_new_blocker");
  });

  it("a generation bump drops every entry of that namespace, and only that one", async () => {
    await get("/gen-search?q=a");
    await get("/search?q=a");
    expect((await get("/gen-search?q=a")).cache).toBe("HIT");
    await bumpResponseCacheGeneration("gsearch");
    expect((await get("/gen-search?q=a")).cache).toBe("MISS");
    expect((await get("/gen-search?q=a")).cache).toBe("HIT");
    expect((await get("/search?q=a")).cache).toBe("HIT");
  });

  it("memoizes the has-blocks lookup instead of querying per request", async () => {
    auth.userId = "viewer_x";
    await get("/search?q=1"); await get("/search?q=2"); await get("/search?q=3");
    expect(blocks.queries).toBe(1);
  });

  it("id-keyed entries ignore the query string and can be invalidated by id", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect((await get(`/product/${id}`)).cache).toBe("MISS");
    expect((await get(`/product/${id}?utm=x`)).cache).toBe("HIT");
    await invalidateResponseCache("product", id);
    const fresh = await get(`/product/${id}`);
    expect(fresh.cache).toBe("MISS");
    expect(fresh.body.n).toBe(2);
  });
});

describe("responseCache fail-open", () => {
  it("serves from the handler when the store throws", async () => {
    __setCacheStoreForTests({
      get: async () => { throw new Error("redis down"); },
      set: async () => { throw new Error("redis down"); },
      del: async () => {},
    });
    await start();
    const a = await get("/search?q=down");
    expect(a.status).toBe(200);
    expect(hits).toBe(1);
  });
});

describe("cacheKeyFor", () => {
  it("rejects idKey on a viewer-scoped cache", () => {
    expect(() => responseCache({ name: "x", ttlSeconds: 1, scope: "viewer-blocks", idKey: () => "1" })).toThrow();
    expect(cacheKeyFor).toBeTypeOf("function");
  });
});
