/**
 * Resumable, chunked upload sessions for every upload route.
 *
 *   POST   /api/upload-sessions                      start  → { uploadId, chunkSize, totalChunks }
 *   GET    /api/upload-sessions/:id                  resume → { received: number[], … }
 *   PUT    /api/upload-sessions/:id/chunks/:index    one raw chunk (idempotent)
 *   POST   /api/upload-sessions/:id/complete         stitch → { uploadId, contentType, size }
 *   DELETE /api/upload-sessions/:id                  abandon
 *
 * A completed session is then handed to the ordinary upload route (avatar,
 * product photo, review photo, profile video, …) by sending an empty request
 * with an `X-Upload-Id` header (raw-body routes) or `{ uploadId }` (JSON
 * routes). `acceptUploadSession` / `readUploadSession` load the stitched bytes
 * and the route then runs exactly as if the bytes had arrived in one request:
 * same validation, same size limit, same moderation, same storage. The session
 * objects are removed once the route has answered (kept on a 5xx so the client
 * can retry the hand-off without re-sending anything).
 *
 * Lifetime: sessions live under a per-person prefix and expire 24 h after
 * they start. An expired session is refused (410) and deleted when touched,
 * and starting a new session sweeps that person's expired or orphaned
 * sessions (bounded work per request). A person may hold at most
 * MAX_OPEN_UPLOAD_SESSIONS live sessions at once.
 *
 * The backend is the Replit / Google Cloud Storage bucket behind
 * ObjectStorageService. Chunks go through the API (not a signed GCS resumable
 * URL) because the Replit storage sidecar only signs plain object URLs; GCS
 * `compose` stitches them server side without the API buffering the file.
 * State lives in object storage, so any API instance can serve any request
 * and an app restart resumes where it stopped.
 */
import express, { Router, type Request, type RequestHandler, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { getAuth } from "@clerk/express";

export const UPLOAD_SESSION_CHUNK_SIZE = 8 * 1024 * 1024;
export const UPLOAD_SESSION_MAX_BYTES = 1024 * 1024 * 1024;
/** Most chunks one session can have (1 GB / 8 MB). */
export const UPLOAD_SESSION_MAX_CHUNKS = Math.ceil(UPLOAD_SESSION_MAX_BYTES / UPLOAD_SESSION_CHUNK_SIZE);
/** Sessions older than this are refused and swept. */
export const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Live (unexpired) sessions one person may hold at once. */
export const MAX_OPEN_UPLOAD_SESSIONS = 6;
/** Upper bound on sessions inspected / deleted by one sweep. */
export const UPLOAD_SESSION_SWEEP_LIMIT = 20;

/** Media any upload route in the app accepts. Each route still applies its own, narrower list. */
export const UPLOAD_SESSION_TYPES: readonly string[] = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/aac", "audio/m4a", "audio/x-m4a",
  "application/pdf",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UploadSessionMeta {
  owner: string;
  contentType: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  createdAt: number;
  assembled?: boolean;
}

export interface UploadSessionStorage {
  createObjectEntityFromBuffer(contents: Buffer, contentType: string, objectPath?: string): Promise<string>;
  getObjectEntityFile(objectPath: string): Promise<{ download(options?: { start?: number; end?: number }): Promise<[Buffer]> }>;
  listObjectEntities(prefixPath: string): Promise<Array<{ objectPath: string; size: number }>>;
  combineObjectEntities(partPaths: string[], destinationPath: string, contentType: string): Promise<void>;
  deleteObjectEntity(objectPath: string): Promise<void>;
}

/** Path-safe, non-reversible folder name for a person's sessions. */
export function ownerKey(owner: string): string {
  return createHash("sha256").update(owner).digest("hex").slice(0, 32);
}

export const ownerSessionsDir = (owner: string) => `/objects/uploads/sessions/${ownerKey(owner)}`;
export const sessionDir = (owner: string, id: string) => `${ownerSessionsDir(owner)}/${id}`;
export const sessionMetaPath = (owner: string, id: string) => `${sessionDir(owner, id)}/meta.json`;
export const sessionChunkPath = (owner: string, id: string, index: number) =>
  `${sessionDir(owner, id)}/p${String(index).padStart(6, "0")}`;
export const sessionAssembledPath = (owner: string, id: string) => `${sessionDir(owner, id)}/assembled`;

export function normalizeContentType(raw: unknown): string {
  return String(raw ?? "").split(";")[0].trim().toLowerCase();
}

/** True when `contentType` matches one of `allowed` (exact, or a `type/*` wildcard). */
export function contentTypeAllowed(contentType: string, allowed: readonly string[]): boolean {
  const ct = normalizeContentType(contentType);
  if (!ct) return false;
  return allowed.some((entry) => {
    const a = entry.toLowerCase();
    return a.endsWith("/*") ? ct.startsWith(a.slice(0, -1)) : a === ct;
  });
}

export function expectedChunkSize(meta: Pick<UploadSessionMeta, "size" | "chunkSize" | "totalChunks">, index: number): number {
  return index === meta.totalChunks - 1 ? meta.size - meta.chunkSize * (meta.totalChunks - 1) : meta.chunkSize;
}

export function isSessionExpired(meta: Pick<UploadSessionMeta, "createdAt">, now: number): boolean {
  return typeof meta.createdAt !== "number" || !Number.isFinite(meta.createdAt) || now - meta.createdAt > UPLOAD_SESSION_TTL_MS;
}

export type StartCheck =
  | { ok: true; contentType: string; size: number; chunkSize: number; totalChunks: number }
  | { ok: false; status: number; error: string };

export function validateSessionStart(body: unknown, chunkSize = UPLOAD_SESSION_CHUNK_SIZE): StartCheck {
  const input = (body ?? {}) as { contentType?: unknown; size?: unknown };
  const contentType = normalizeContentType(input.contentType);
  const size = Number(input.size);
  if (!contentTypeAllowed(contentType, UPLOAD_SESSION_TYPES)) {
    return { ok: false, status: 415, error: "Unsupported file type" };
  }
  if (!Number.isSafeInteger(size) || size <= 0 || size > UPLOAD_SESSION_MAX_BYTES) {
    return { ok: false, status: 400, error: "File is empty or larger than 1 GB" };
  }
  return { ok: true, contentType, size, chunkSize, totalChunks: Math.ceil(size / chunkSize) };
}

/** Indexes whose stored size matches the declared layout, ascending. */
export function completedChunks(meta: UploadSessionMeta, listed: Array<{ objectPath: string; size: number }>): number[] {
  const done = new Set<number>();
  for (const item of listed) {
    const match = /\/p(\d{6})$/.exec(item.objectPath);
    if (!match) continue;
    const index = Number(match[1]);
    if (index < meta.totalChunks && item.size === expectedChunkSize(meta, index)) done.add(index);
  }
  return [...done].sort((a, b) => a - b);
}

export type ActorResolver = (req: Request) => string | undefined;

/**
 * The signed-in human (not the team-context store owner, which teamContext
 * may substitute into `clerkUserId` on seller routes): a session belongs to
 * the person who started it, wherever they hand it off.
 */
export const defaultActorId: ActorResolver = (req) => {
  try {
    const userId = getAuth(req)?.userId;
    if (userId) return userId;
  } catch {
    // No Clerk context on this request; fall back to what requireAuth set.
  }
  return (req as Request & { clerkUserId?: string }).clerkUserId;
};

export type SessionLookup =
  | { status: "ok"; meta: UploadSessionMeta }
  | { status: "expired"; meta: UploadSessionMeta }
  | { status: "missing" };

async function readMeta(storage: UploadSessionStorage, path: string): Promise<UploadSessionMeta | null> {
  try {
    const file = await storage.getObjectEntityFile(path);
    const [bytes] = await file.download();
    return JSON.parse(bytes.toString("utf8")) as UploadSessionMeta;
  } catch {
    return null;
  }
}

export async function lookupSession(
  storage: UploadSessionStorage,
  id: string,
  owner: string | undefined,
  now: number = Date.now(),
): Promise<SessionLookup> {
  if (!owner || !UUID_RE.test(id)) return { status: "missing" };
  const meta = await readMeta(storage, sessionMetaPath(owner, id));
  if (!meta || meta.owner !== owner) return { status: "missing" };
  return isSessionExpired(meta, now) ? { status: "expired", meta } : { status: "ok", meta };
}

/** Live session meta, or null (missing, someone else's, or expired). */
export async function loadSessionMeta(
  storage: UploadSessionStorage,
  id: string,
  owner: string | undefined,
  now: number = Date.now(),
): Promise<UploadSessionMeta | null> {
  const found = await lookupSession(storage, id, owner, now);
  return found.status === "ok" ? found.meta : null;
}

export async function discardSession(storage: UploadSessionStorage, id: string, meta: UploadSessionMeta): Promise<void> {
  const totalChunks = Math.min(Math.max(0, Math.floor(meta.totalChunks) || 0), UPLOAD_SESSION_MAX_CHUNKS);
  const paths = [
    sessionMetaPath(meta.owner, id),
    sessionAssembledPath(meta.owner, id),
    ...Array.from({ length: totalChunks }, (_, i) => sessionChunkPath(meta.owner, id, i)),
  ];
  await Promise.all(paths.map((p) => storage.deleteObjectEntity(p).catch(() => {})));
}

/**
 * Deletes this person's expired sessions (and orphaned parts whose meta is
 * gone), inspecting at most UPLOAD_SESSION_SWEEP_LIMIT sessions, and returns
 * how many live sessions remain among those inspected.
 */
export async function sweepOwnerSessions(
  storage: UploadSessionStorage,
  owner: string,
  now: number,
): Promise<{ live: number; removed: number }> {
  const prefix = `${ownerSessionsDir(owner)}/`;
  const listed = await storage.listObjectEntities(prefix);
  const byId = new Map<string, string[]>();
  for (const item of listed) {
    const rest = item.objectPath.slice(prefix.length);
    const id = rest.split("/")[0];
    if (!UUID_RE.test(id)) continue;
    const paths = byId.get(id) ?? [];
    paths.push(item.objectPath);
    byId.set(id, paths);
  }
  let live = 0;
  let removed = 0;
  for (const [id, paths] of [...byId.entries()].slice(0, UPLOAD_SESSION_SWEEP_LIMIT)) {
    const meta = await readMeta(storage, sessionMetaPath(owner, id));
    if (meta && meta.owner === owner && !isSessionExpired(meta, now)) {
      live += 1;
      continue;
    }
    // Expired, or parts left behind without a meta object (an abandoned
    // discard): remove exactly what is listed.
    await Promise.all(paths.map((p) => storage.deleteObjectEntity(p).catch(() => {})));
    removed += 1;
  }
  return { live, removed };
}

async function lazyStorage(): Promise<UploadSessionStorage> {
  const { ObjectStorageService } = await import("./objectStorage");
  return new ObjectStorageService() as unknown as UploadSessionStorage;
}

type StorageProvider = UploadSessionStorage | (() => Promise<UploadSessionStorage>);
const resolveStorage = (s: StorageProvider | undefined) =>
  !s ? lazyStorage() : typeof s === "function" ? s() : Promise.resolve(s);

export interface UploadSessionRouterOptions {
  storage?: StorageProvider;
  actorId?: ActorResolver;
  now?: () => number;
  chunkSize?: number;
}

const EXPIRED_MESSAGE = "This upload expired. Please start it again.";

export function createUploadSessionRouter(options: UploadSessionRouterOptions = {}) {
  const router = Router();
  const actorId = options.actorId ?? defaultActorId;
  const now = options.now ?? Date.now;
  const chunkSize = options.chunkSize ?? UPLOAD_SESSION_CHUNK_SIZE;
  const log = (req: Request) => (req as Request & { log?: { error: (o: unknown, m: string) => void } }).log;

  /** Live session for this request, or an error response already sent. */
  async function sessionFor(req: Request, res: Response): Promise<{ storage: UploadSessionStorage; owner: string; id: string; meta: UploadSessionMeta } | null> {
    const id = String(req.params.uploadId);
    const owner = actorId(req);
    const storage = await resolveStorage(options.storage);
    const found = await lookupSession(storage, id, owner, now());
    if (found.status === "missing" || !owner) {
      res.status(404).json({ error: "Upload not found" });
      return null;
    }
    if (found.status === "expired") {
      void discardSession(storage, id, found.meta);
      res.status(410).json({ error: EXPIRED_MESSAGE, code: "UPLOAD_EXPIRED" });
      return null;
    }
    return { storage, owner, id, meta: found.meta };
  }

  router.post("/", express.json({ limit: "4kb" }), async (req, res) => {
    const owner = actorId(req);
    if (!owner) return res.status(401).json({ error: "Unauthorized" });
    const check = validateSessionStart(req.body, chunkSize);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    const uploadId = randomUUID();
    const meta: UploadSessionMeta = {
      owner, contentType: check.contentType, size: check.size,
      chunkSize: check.chunkSize, totalChunks: check.totalChunks, createdAt: now(),
    };
    try {
      const storage = await resolveStorage(options.storage);
      const { live } = await sweepOwnerSessions(storage, owner, meta.createdAt);
      if (live >= MAX_OPEN_UPLOAD_SESSIONS) {
        return res.status(429).json({
          error: "Too many uploads in progress. Let one finish and try again.",
          code: "TOO_MANY_OPEN_UPLOADS",
        });
      }
      await storage.createObjectEntityFromBuffer(Buffer.from(JSON.stringify(meta)), "application/json", sessionMetaPath(owner, uploadId));
      return res.status(201).json({ uploadId, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks });
    } catch (err) {
      log(req)?.error({ err }, "Could not start upload session");
      return res.status(500).json({ error: "Upload could not be started" });
    }
  });

  router.get("/:uploadId", async (req, res) => {
    const session = await sessionFor(req, res);
    if (!session) return undefined;
    const { storage, owner, id, meta } = session;
    try {
      const received = meta.assembled
        ? Array.from({ length: meta.totalChunks }, (_, i) => i)
        : completedChunks(meta, await storage.listObjectEntities(`${sessionDir(owner, id)}/p`));
      return res.json({
        uploadId: id, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks,
        received, assembled: meta.assembled === true,
      });
    } catch (err) {
      log(req)?.error({ err }, "Could not read upload session");
      return res.status(500).json({ error: "Upload state unavailable" });
    }
  });

  router.put(
    "/:uploadId/chunks/:index",
    express.raw({ type: "application/octet-stream", limit: chunkSize + 1024 }),
    async (req, res) => {
      const session = await sessionFor(req, res);
      if (!session) return undefined;
      const { storage, owner, id, meta } = session;
      const index = Number(req.params.index);
      if (meta.assembled) return res.status(409).json({ error: "Upload is already complete" });
      if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
        return res.status(400).json({ error: "Chunk index out of range" });
      }
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length !== expectedChunkSize(meta, index)) {
        return res.status(400).json({ error: "Chunk size does not match the declared upload" });
      }
      try {
        await storage.createObjectEntityFromBuffer(bytes, "application/octet-stream", sessionChunkPath(owner, id, index));
        return res.json({ index, size: bytes.length });
      } catch (err) {
        log(req)?.error({ err, uploadId: id, index }, "Could not store upload chunk");
        return res.status(500).json({ error: "Chunk could not be stored" });
      }
    },
  );

  router.post("/:uploadId/complete", async (req, res) => {
    const session = await sessionFor(req, res);
    if (!session) return undefined;
    const { storage, owner, id, meta } = session;
    if (meta.assembled) return res.json({ uploadId: id, contentType: meta.contentType, size: meta.size });
    try {
      const done = new Set(completedChunks(meta, await storage.listObjectEntities(`${sessionDir(owner, id)}/p`)));
      const missing: number[] = [];
      for (let i = 0; i < meta.totalChunks; i += 1) if (!done.has(i)) missing.push(i);
      if (missing.length > 0) return res.status(409).json({ error: "Upload is incomplete", missing });
      await storage.combineObjectEntities(
        Array.from({ length: meta.totalChunks }, (_, i) => sessionChunkPath(owner, id, i)),
        sessionAssembledPath(owner, id),
        meta.contentType,
      );
      const next: UploadSessionMeta = { ...meta, assembled: true };
      await storage.createObjectEntityFromBuffer(Buffer.from(JSON.stringify(next)), "application/json", sessionMetaPath(owner, id));
      // The parts are no longer needed once the assembled object exists.
      await Promise.all(Array.from({ length: meta.totalChunks }, (_, i) =>
        storage.deleteObjectEntity(sessionChunkPath(owner, id, i)).catch(() => {})));
      return res.json({ uploadId: id, contentType: meta.contentType, size: meta.size });
    } catch (err) {
      log(req)?.error({ err, uploadId: id }, "Could not finish upload session");
      return res.status(500).json({ error: "Upload could not be finished" });
    }
  });

  router.delete("/:uploadId", async (req, res) => {
    const session = await sessionFor(req, res);
    if (!session) return undefined;
    await discardSession(session.storage, session.id, session.meta);
    return res.status(204).end();
  });

  return router;
}

export interface SessionHandoffOptions {
  /** The route's own accepted types (exact or `type/*`). */
  allowedTypes: readonly string[];
  /** The route's own size limit, enforced exactly as its body parser would. */
  maxBytes: number;
  storage?: StorageProvider;
  actorId?: ActorResolver;
  now?: () => number;
}

export type SessionRead =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; status: number; error: string };

/**
 * Loads a completed session's bytes for a route, and removes the session once
 * the response has gone out (unless the route failed with a 5xx).
 */
export async function readUploadSession(
  req: Request,
  res: Response,
  uploadId: string,
  options: SessionHandoffOptions,
): Promise<SessionRead> {
  const storage = await resolveStorage(options.storage);
  const owner = (options.actorId ?? defaultActorId)(req);
  const found = await lookupSession(storage, uploadId, owner, (options.now ?? Date.now)());
  if (found.status === "missing") return { ok: false, status: 404, error: "Upload not found" };
  if (found.status === "expired") {
    void discardSession(storage, uploadId, found.meta);
    return { ok: false, status: 410, error: EXPIRED_MESSAGE };
  }
  const meta = found.meta;
  if (!meta.assembled) return { ok: false, status: 409, error: "Upload is incomplete" };
  if (!contentTypeAllowed(meta.contentType, options.allowedTypes)) {
    return { ok: false, status: 415, error: "Unsupported file type" };
  }
  if (meta.size > options.maxBytes) return { ok: false, status: 413, error: "File is too large" };
  const file = await storage.getObjectEntityFile(sessionAssembledPath(meta.owner, uploadId));
  const [buffer] = await file.download();
  if (buffer.length !== meta.size) return { ok: false, status: 409, error: "Upload is incomplete" };
  res.on("finish", () => {
    if (res.statusCode < 500) void discardSession(storage, uploadId, meta);
  });
  return { ok: true, buffer, contentType: meta.contentType };
}

function requestHasBody(req: Request): boolean {
  const length = req.headers["content-length"];
  return req.headers["transfer-encoding"] !== undefined || (length !== undefined && Number(length) > 0);
}

/**
 * Raw-body routes: place before the route's `express.raw(...)`. Requests
 * without an `X-Upload-Id` header pass straight through untouched.
 */
export function acceptUploadSession<P = Request["params"]>(options: SessionHandoffOptions): RequestHandler<P> {
  return async (request, res, next) => {
    const req = request as unknown as Request;
    const uploadId = req.get("x-upload-id");
    if (!uploadId) return next();
    if (requestHasBody(req)) {
      return res.status(400).json({ error: "Send either a file body or an upload id, not both" });
    }
    try {
      const read = await readUploadSession(req, res, uploadId.trim(), options);
      if (!read.ok) return res.status(read.status).json({ error: read.error });
      req.body = read.buffer;
      // The request itself carried no body. Dropping its (zero) Content-Length
      // makes the route's own body parser see "no body" and keep req.body.
      delete req.headers["content-length"];
      req.headers["content-type"] = read.contentType;
      return next();
    } catch (err) {
      (req as Request & { log?: { error: (o: unknown, m: string) => void } }).log?.error({ err, uploadId }, "Could not load upload session");
      return res.status(500).json({ error: "Upload could not be read" });
    }
  };
}
