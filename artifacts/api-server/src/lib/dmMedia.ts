/**
 * DM media privacy.
 *
 * New DM uploads (POST /api/conversations/upload-media) are stored PRIVATE in
 * the private object dir at `/objects/messaging/<uploaderId>/<uuid>.<ext>`.
 * That canonical path is what a message row stores; every read path that
 * returns message media to a participant swaps it for a short-lived signed
 * URL generated here (the same signing reviews and returns use).
 *
 * Backward compatibility: messages sent before this change hold permanent
 * public `https://storage.googleapis.com/<bucket>/messaging/...` URLs. Those
 * objects are still public, so they are left untouched on read and keep
 * rendering exactly as before.
 *
 * The normalizing half is pure (no network/DB) so it can be unit-tested and
 * reused by dmAttachmentPolicy; signing lazily imports objectStorage.
 */
import { resolveCdnBase } from "./cdnUrl";
import { logger } from "./logger";

export const DM_MEDIA_OBJECT_PREFIX = "/objects/messaging/";

/** Signed DM media URLs live this long; clients refetch messages well within it. */
export const DM_MEDIA_SIGNED_URL_TTL_SEC = 60 * 60;

/** `/objects/messaging/<uploaderId>/<uuid>.<ext>` — the only shape upload-media ever creates. */
const CANONICAL_DM_MEDIA_RE = /^\/objects\/messaging\/[A-Za-z0-9_-]{1,128}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

const STORAGE_ORIGIN = "https://storage.googleapis.com";

export interface DmMediaContext {
  /** DEFAULT_OBJECT_STORAGE_BUCKET_ID (legacy public uploads lived here). */
  bucketId: string;
  /** PRIVATE_OBJECT_DIR, e.g. `/bucket/.private` (new private uploads live here). */
  privateDir: string;
  /** CDN origin signed URLs may be rewritten to (cdnUrl.ts), or null. */
  cdnBase: string | null;
}

export function dmMediaContextFromEnv(env: Record<string, string | undefined> = process.env): DmMediaContext {
  return {
    bucketId: (env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "").trim(),
    privateDir: (env.PRIVATE_OBJECT_DIR ?? "").trim(),
    cdnBase: resolveCdnBase(env),
  };
}

export function isCanonicalDmMediaPath(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_DM_MEDIA_RE.test(value);
}

function normalizedPrivateDir(dir: string): string {
  if (!dir) return "";
  const withLead = dir.startsWith("/") ? dir : `/${dir}`;
  return withLead.replace(/\/+$/, "");
}

/** Pathname of a storage (or CDN-rewritten storage) URL, or null for any other host. */
function storagePathname(url: URL, cdnBase: string | null): string | null {
  if (url.origin === STORAGE_ORIGIN) return url.pathname;
  if (!cdnBase) return null;
  let cdn: URL;
  try { cdn = new URL(cdnBase); } catch { return null; }
  if (url.origin !== cdn.origin) return null;
  const prefix = cdn.pathname.replace(/\/+$/, "");
  if (prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  return url.pathname.slice(prefix.length);
}

export type DmMediaRef =
  | { ok: true; kind: "canonical" | "legacy" | "external"; value: string }
  | { ok: false };

/**
 * Maps a media uri a client sends on a message to what the server stores.
 *  - canonical `/objects/messaging/...` path → itself
 *  - our signed URL for such a path (storage host or CDN) → canonical path
 *  - a legacy public URL in our bucket → unchanged (old messages, forwards)
 *  - with no bucket/private dir configured (dev), any https URL → unchanged
 * Anything else — other hosts, other private objects, other signed URLs — is
 * refused, so a message can never make the server sign a non-DM object.
 */
export function resolveDmMediaRef(uri: unknown, ctx: DmMediaContext): DmMediaRef {
  if (typeof uri !== "string" || !uri) return { ok: false };
  if (uri.startsWith("/")) {
    return isCanonicalDmMediaPath(uri) ? { ok: true, kind: "canonical", value: uri } : { ok: false };
  }
  if (!/^https:\/\//i.test(uri)) return { ok: false };
  let url: URL;
  try { url = new URL(uri); } catch { return { ok: false }; }

  const privateDir = normalizedPrivateDir(ctx.privateDir);
  const rawPath = storagePathname(url, ctx.cdnBase);
  if (rawPath != null) {
    let path: string;
    try { path = decodeURIComponent(rawPath); } catch { return { ok: false }; }
    if (privateDir && path.startsWith(`${privateDir}/`)) {
      // Our private dir: only DM media may be referenced (and is stored canonical).
      const canonical = `/objects/${path.slice(privateDir.length + 1)}`;
      return isCanonicalDmMediaPath(canonical) ? { ok: true, kind: "canonical", value: canonical } : { ok: false };
    }
    if (ctx.bucketId && url.origin === STORAGE_ORIGIN && uri.startsWith(`${STORAGE_ORIGIN}/${ctx.bucketId}/`)) {
      // Legacy public upload. A query string would mean a signed URL for
      // something outside the private dir — not something upload-media made.
      return url.search ? { ok: false } : { ok: true, kind: "legacy", value: uri };
    }
  }
  if (!ctx.bucketId && !privateDir) return { ok: true, kind: "external", value: uri };
  return { ok: false };
}

// ── Signing (read side) ──────────────────────────────────────────────────────

type CacheEntry = { url: string; expiresAt: number };
const SIGNED_CACHE_MAX = 5000;
/** Reuse a cached URL while it still has this long to live. */
const SIGNED_CACHE_MIN_REMAINING_MS = 20 * 60 * 1000;
const signedCache = new Map<string, CacheEntry>();

/**
 * Clients poll the thread; returning the SAME signed URL for a while (instead
 * of a fresh signature on every poll) keeps their image caches warm and avoids
 * re-downloading media every few seconds. Callers have already checked that
 * the viewer is a participant — the cache never bypasses that check.
 */
export async function signDmMediaPath(
  path: string,
  opts: { ttlSec?: number; useCache?: boolean } = {},
): Promise<string | null> {
  if (!isCanonicalDmMediaPath(path)) return null;
  const ttlSec = opts.ttlSec ?? DM_MEDIA_SIGNED_URL_TTL_SEC;
  const useCache = opts.useCache ?? ttlSec === DM_MEDIA_SIGNED_URL_TTL_SEC;
  const now = Date.now();
  if (useCache) {
    const hit = signedCache.get(path);
    if (hit && hit.expiresAt - now > SIGNED_CACHE_MIN_REMAINING_MS) return hit.url;
  }
  try {
    const { ObjectStorageService } = await import("./objectStorage");
    const url = await new ObjectStorageService().getObjectEntityDownloadURL(path, ttlSec);
    if (useCache) {
      signedCache.delete(path);
      signedCache.set(path, { url, expiresAt: now + ttlSec * 1000 });
      while (signedCache.size > SIGNED_CACHE_MAX) {
        const oldest = signedCache.keys().next().value;
        if (oldest === undefined) break;
        signedCache.delete(oldest);
      }
    }
    return url;
  } catch (err) {
    logger.warn({ err, path }, "Could not sign DM media path");
    return null;
  }
}

/** Test hook. */
export function clearDmMediaSignCache(): void {
  signedCache.clear();
}

const MEDIA_TYPES = new Set(["image", "video", "voice"]);

type Signer = (path: string) => Promise<string | null>;

async function signValue(value: unknown, sign: Signer): Promise<unknown> {
  if (!isCanonicalDmMediaPath(value)) return value;
  // Unsignable (storage outage): keep the path rather than drop the attachment.
  return (await sign(value)) ?? value;
}

async function signAttachment(att: unknown, sign: Signer): Promise<unknown> {
  if (!att || typeof att !== "object") return att;
  const a = att as { type?: unknown; uri?: unknown; meta?: Record<string, unknown> | null };
  if (typeof a.type !== "string" || !MEDIA_TYPES.has(a.type)) return att;
  const next: Record<string, unknown> = { ...(att as Record<string, unknown>) };
  next.uri = await signValue(a.uri, sign);
  const photoUris = a.meta?.photoUris;
  if (typeof photoUris === "string" && photoUris.includes(DM_MEDIA_OBJECT_PREFIX)) {
    try {
      const list = JSON.parse(photoUris);
      if (Array.isArray(list)) {
        const signed = await Promise.all(list.map((u) => signValue(u, sign)));
        next.meta = { ...a.meta, photoUris: JSON.stringify(signed) };
      }
    } catch { /* leave malformed meta as stored */ }
  }
  return next;
}

/**
 * Replaces canonical DM media paths on message-shaped objects (`attachment`
 * + `attachments`) with signed URLs, in place on the message objects (the
 * attachment objects themselves are copied, never mutated). Legacy public
 * URLs and non-media cards pass through unchanged.
 */
export async function signDmMessageMedia<T extends { attachment?: unknown; attachments?: unknown }>(
  msgs: T[],
  opts: { ttlSec?: number } = {},
): Promise<T[]> {
  const memo = new Map<string, Promise<string | null>>();
  const sign: Signer = (path) => {
    let p = memo.get(path);
    if (!p) {
      p = signDmMediaPath(path, { ttlSec: opts.ttlSec });
      memo.set(path, p);
    }
    return p;
  };
  // Chunked so a large data export doesn't fire thousands of signing calls at once.
  const CHUNK = 25;
  for (let i = 0; i < msgs.length; i += CHUNK) {
    await Promise.all(msgs.slice(i, i + CHUNK).map(async (m) => {
      if (m.attachment != null) (m as any).attachment = await signAttachment(m.attachment, sign);
      if (Array.isArray(m.attachments)) {
        (m as any).attachments = await Promise.all(m.attachments.map((a) => signAttachment(a, sign)));
      }
    }));
  }
  return msgs;
}
