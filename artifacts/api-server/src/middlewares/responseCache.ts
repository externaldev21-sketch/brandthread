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
 * keyed by an id (see `idKey`), plus bumpResponseCacheGeneration(name) for
 * URL-keyed entries that opt into `generational` (a new product must show in
 * search on the next request, not after the TTL). Blocking or unblocking clears
 * the "has any blocks" memo for both people (forgetViewerBlocksMemo).
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
  /** Key entries by a namespace generation so bumpResponseCacheGeneration(name) drops them all at once. */
  generational?: boolean;
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

const blocksMemoKey = (viewerId: string) => `rc:hasblocks:${viewerId}`;
const generationKey = (name: string) => `rc:gen:${name}`;
// Generations outlive any entry's TTL; if one expires, the namespace simply
// restarts at "0", whose entries are long gone by then.
const GENERATION_TTL_SECONDS = 7 * 24 * 60 * 60;

async function hasBlocks(viewerId: string): Promise<boolean> {
  const store = getCacheStore();
  const memoKey = blocksMemoKey(viewerId);
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

/** A block or unblock changes which entry these viewers must read; drop their memo. */
export async function forgetViewerBlocksMemo(...viewerIds: string[]): Promise<void> {
  if (viewerIds.length === 0) return;
  await getCacheStore()?.del(...viewerIds.map(blocksMemoKey));
}

/** Drop every entry of a `generational` namespace (e.g. "search" after a product goes live). */
export async function bumpResponseCacheGeneration(name: string): Promise<void> {
  await getCacheStore()?.set(generationKey(name), `${Date.now()}`, GENERATION_TTL_SECONDS);
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
      let scopeId = await scopeIdFor(opts.scope, req);
      if (opts.generational) scopeId = `${scopeId}:g${(await store.get(generationKey(opts.name))) ?? "0"}`;
      key = cacheKeyFor(opts, req, scopeId);
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
