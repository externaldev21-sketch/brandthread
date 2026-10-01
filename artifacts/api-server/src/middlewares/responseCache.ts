/**
 * Shared response cache for GET endpoints whose answer is identical for many
 * callers (search, product page, public profile).
 *
 *  - Off unless a cache store exists (REDIS_URL set, CACHE_DISABLED != 1): then
 *    this middleware is a pass-through and behavior is exactly as before.
 *  - Only 200 JSON responses are stored. Errors are never cached.
 *  - Single-flight: when N requests miss on the same key at once, one runs the
 *    handler and the rest wait for its answer, so a hot key costs one database
 *    query, not N.
 *  - Viewer scope. These endpoints hide content the viewer has blocked (or been
 *    blocked by). Viewers with no block relationships get exactly the anonymous
 *    answer, so they share one entry; a viewer who has any block gets their own
 *    entry, so nobody is ever served someone else's block-filtered view.
 *  - Fail-open: any store error is treated as a miss.
 *
 * Invalidation: TTL expiry, plus invalidateResponseCache(name, id) for entries
 * keyed by an id (see `idKey`).
 */
import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { getAuth } from "@clerk/express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getCacheStore } from "../lib/cacheStore";

type Scope = "anon" | "viewer-blocks";

export type ResponseCacheOptions = {
  /** Namespace, e.g. "search". */
  name: string;
  ttlSeconds: number;
  /** "anon": identical for everyone. "viewer-blocks": varies only by the viewer's block relationships. */
  scope: Scope;
  /** Id for invalidation, e.g. (req) => req.params.id. Requires scope "anon". Omit to key on the normalized URL. */
  idKey?: (req: Request) => string | undefined;
  /** Bypass the cache for a request. */
  skip?: (req: Request) => boolean;
};

type Stored = { status: 200; body: unknown; cacheControl?: string };

const inflight = new Map<string, Promise<Stored | null>>();
const BLOCKS_TTL_SECONDS = 60;

export function normalizedQuery(req: Request): string {
  const params = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
  const pairs = [...params.entries()].sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

export function cacheKeyFor(opts: ResponseCacheOptions, req: Request, scopeId: string): string {
  const id = opts.idKey?.(req);
  // Id-keyed entries (anon scope only) ignore the query string so they can be
  // invalidated by id alone: rc:<name>:<id>.
  if (id !== undefined) return `rc:${opts.name}:${id}`;
  const path = req.baseUrl + req.path;
  const hash = createHash("sha1").update(`${path}?${normalizedQuery(req)}`).digest("hex");
  return `rc:${opts.name}:${scopeId}:${hash}`;
}

function viewerIdOf(req: Request): string | null {
  try { return getAuth(req).userId ?? null; } catch { return null; }
}

async function hasBlocks(viewerId: string): Promise<boolean> {
  const store = getCacheStore();
  const memoKey = `rc:hasblocks:${viewerId}`;
  const memo = store ? await store.get(memoKey) : null;
  if (memo !== null) return memo === "1";
  const rows = (await db.execute(sql`
    SELECT 1 FROM blocks WHERE blocker_id = ${viewerId} OR blocked_id = ${viewerId} LIMIT 1`)).rows;
  const result = rows.length > 0;
  if (store) await store.set(memoKey, result ? "1" : "0", BLOCKS_TTL_SECONDS);
  return result;
}

async function scopeIdFor(scope: Scope, req: Request): Promise<string> {
  if (scope === "anon") return "all";
  const viewer = viewerIdOf(req);
  if (!viewer) return "all";
  return (await hasBlocks(viewer)) ? `u:${viewer}` : "all";
}

/** Drop an id-keyed entry (e.g. after a product edit) so the next read is fresh. */
export async function invalidateResponseCache(name: string, id: string): Promise<void> {
  await getCacheStore()?.del(`rc:${name}:${id}`);
}

export function responseCache(opts: ResponseCacheOptions): RequestHandler {
  if (opts.idKey && opts.scope !== "anon") throw new Error("responseCache: idKey requires scope 'anon'");
  return async (req, res, next) => {
    const store = getCacheStore();
    if (!store || req.method !== "GET" || opts.skip?.(req)) { next(); return; }

    let key: string;
    try {
      key = cacheKeyFor(opts, req, await scopeIdFor(opts.scope, req));
    } catch {
      next();
      return;
    }

    const send = (stored: Stored, state: "HIT" | "COALESCED") => {
      res.setHeader("X-Cache", state);
      if (stored.cacheControl) res.setHeader("Cache-Control", stored.cacheControl);
      res.status(stored.status).json(stored.body);
    };

    try {
      const raw = await store.get(key);
      if (raw) { send(JSON.parse(raw) as Stored, "HIT"); return; }
    } catch { /* treat as a miss */ }

    const pending = inflight.get(key);
    if (pending) {
      const shared = await pending;
      if (shared) { send(shared, "COALESCED"); return; }
      next(); // leader failed or wasn't cacheable; run our own handler
      return;
    }

    let settle!: (value: Stored | null) => void;
    inflight.set(key, new Promise<Stored | null>((resolve) => { settle = resolve; }));

    const originalJson = res.json.bind(res) as Response["json"];
    let captured: Stored | null = null;
    res.json = ((body: unknown) => {
      if (res.statusCode === 200) {
        const cc = res.getHeader("Cache-Control");
        captured = { status: 200, body, cacheControl: typeof cc === "string" ? cc : undefined };
      }
      return originalJson(body);
    }) as Response["json"];

    res.setHeader("X-Cache", "MISS");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      inflight.delete(key);
      settle(captured);
      if (captured) void store.set(key, JSON.stringify(captured), opts.ttlSeconds).catch(() => {});
    };
    res.once("finish", finish);
    res.once("close", finish);
    next();
  };
}
