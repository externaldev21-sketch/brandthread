/**
 * Chunked, resumable upload for long post videos (up to 10 minutes).
 *
 * POST   /api/posts/uploads                        — start a session → { uploadId, chunkSize, totalChunks }
 * GET    /api/posts/uploads/:uploadId              — which chunk indexes already landed (resume)
 * PUT    /api/posts/uploads/:uploadId/chunks/:n    — one raw chunk (idempotent, safe to retry)
 * POST   /api/posts/uploads/:uploadId/complete     — stitch chunks → { objectPath, contentType, size }
 * DELETE /api/posts/uploads/:uploadId              — abandon
 *
 * `complete` returns the same shape as POST /video-clips, so the existing
 * compose-video pipeline consumes the result unchanged. Session state lives
 * in object storage (a small owner-stamped meta object plus one object per
 * chunk), so any API instance can serve any request and a retry after an app
 * restart resumes where it left off.
 */
import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { cappedUnknown, looseBody, validateBody } from "../middlewares/bodySchemas";

const router = Router();

// Shape + size guards; the handler checks content type and size limits.
const startUploadBody = looseBody({ contentType: cappedUnknown(200), size: cappedUnknown(64) });
const storage = new ObjectStorageService();

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
export const CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_CHUNKED_BYTES = 1024 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UploadMeta {
  owner: string;
  contentType: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
}

const sessionDir = (id: string) => `/objects/uploads/chunked/${id}`;
const metaPath = (id: string) => `${sessionDir(id)}/meta.json`;
const chunkPath = (id: string, index: number) => `${sessionDir(id)}/p${String(index).padStart(6, "0")}`;

/** Sellers and buyers can both publish their own media (buyers: profile POSTs only). */
async function isSeller(clerkId: string): Promise<boolean> {
  const [user] = await db.select({ accountType: users.accountType })
    .from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return user?.accountType === "seller" || user?.accountType === "buyer";
}

async function loadMeta(id: string, clerkId: string): Promise<UploadMeta | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    const file = await storage.getObjectEntityFile(metaPath(id));
    const [bytes] = await file.download();
    const meta = JSON.parse(bytes.toString("utf8")) as UploadMeta;
    return meta.owner === clerkId ? meta : null;
  } catch {
    return null;
  }
}

function isSupportedVideo(contentType: string, head: Buffer): boolean {
  if (!VIDEO_TYPES.has(contentType)) return false;
  const isoMedia = head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp";
  const webm = head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return isoMedia || webm;
}

async function receivedChunks(id: string): Promise<Map<number, number>> {
  const listed = await storage.listObjectEntities(`${sessionDir(id)}/p`);
  const received = new Map<number, number>();
  for (const item of listed) {
    const match = /\/p(\d{6})$/.exec(item.objectPath);
    if (match) received.set(Number(match[1]), item.size);
  }
  return received;
}

router.post("/uploads", requireAuth, express.json(), validateBody(startUploadBody), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  if (!(await isSeller(clerkId))) return res.status(403).json({ error: "Seller or buyer account required" });
  const contentType = String(req.body?.contentType ?? "").split(";")[0].toLowerCase();
  const size = Number(req.body?.size);
  if (!VIDEO_TYPES.has(contentType)) return res.status(415).json({ error: "Unsupported video type" });
  if (!Number.isInteger(size) || size <= 0 || size > MAX_CHUNKED_BYTES) {
    return res.status(400).json({ error: "Video is empty or larger than 1 GB" });
  }
  const uploadId = randomUUID();
  const meta: UploadMeta = {
    owner: clerkId, contentType, size, chunkSize: CHUNK_SIZE, totalChunks: Math.ceil(size / CHUNK_SIZE),
  };
  try {
    await storage.createObjectEntityFromBuffer(Buffer.from(JSON.stringify(meta)), "application/json", metaPath(uploadId));
    return res.status(201).json({ uploadId, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks });
  } catch (err) {
    req.log.error({ err, clerkId }, "Could not start chunked upload");
    return res.status(500).json({ error: "Upload could not be started" });
  }
});

router.get("/uploads/:uploadId", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const uploadId = String(req.params.uploadId);
  const meta = await loadMeta(uploadId, clerkId);
  if (!meta) return res.status(404).json({ error: "Upload not found" });
  try {
    const received = await receivedChunks(uploadId);
    const done = [...received.entries()].filter(([index, size]) => size === expectedChunkSize(meta, index)).map(([i]) => i);
    return res.json({ uploadId, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks, received: done.sort((a, b) => a - b) });
  } catch (err) {
    req.log.error({ err, clerkId }, "Could not read chunked upload state");
    return res.status(500).json({ error: "Upload state unavailable" });
  }
});

function expectedChunkSize(meta: UploadMeta, index: number): number {
  return index === meta.totalChunks - 1 ? meta.size - meta.chunkSize * (meta.totalChunks - 1) : meta.chunkSize;
}

router.put(
  "/uploads/:uploadId/chunks/:index",
  requireAuth,
  express.raw({ type: "application/octet-stream", limit: CHUNK_SIZE + 1024 }),
  async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const uploadId = String(req.params.uploadId);
    const index = Number(req.params.index);
    const meta = await loadMeta(uploadId, clerkId);
    if (!meta) return res.status(404).json({ error: "Upload not found" });
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
      return res.status(400).json({ error: "Chunk index out of range" });
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length !== expectedChunkSize(meta, index)) {
      return res.status(400).json({ error: "Chunk size does not match the declared upload" });
    }
    try {
      await storage.createObjectEntityFromBuffer(bytes, "application/octet-stream", chunkPath(uploadId, index));
      return res.json({ index, size: bytes.length });
    } catch (err) {
      req.log.error({ err, clerkId, uploadId, index }, "Could not store upload chunk");
      return res.status(500).json({ error: "Chunk could not be stored" });
    }
  },
);

router.post("/uploads/:uploadId/complete", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const uploadId = String(req.params.uploadId);
  const meta = await loadMeta(uploadId, clerkId);
  if (!meta) return res.status(404).json({ error: "Upload not found" });
  let objectPath: string | null = null;
  try {
    const received = await receivedChunks(uploadId);
    const missing: number[] = [];
    for (let i = 0; i < meta.totalChunks; i += 1) {
      if (received.get(i) !== expectedChunkSize(meta, i)) missing.push(i);
    }
    if (missing.length > 0) return res.status(409).json({ error: "Upload is incomplete", missing });

    const first = await storage.getObjectEntityFile(chunkPath(uploadId, 0));
    const [head] = await first.download({ start: 0, end: 15 });
    if (!isSupportedVideo(meta.contentType, head)) {
      await abandon(uploadId, meta);
      return res.status(400).json({ error: "Invalid video file" });
    }

    objectPath = `/objects/uploads/${randomUUID()}`;
    await storage.combineObjectEntities(
      Array.from({ length: meta.totalChunks }, (_, i) => chunkPath(uploadId, i)),
      objectPath,
      meta.contentType,
    );
    await storage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkId, visibility: "private" });
    await abandon(uploadId, meta);
    return res.status(201).json({ objectPath, contentType: meta.contentType, size: meta.size });
  } catch (err) {
    if (objectPath) await storage.deleteObjectEntity(objectPath).catch(() => {});
    req.log.error({ err, clerkId, uploadId }, "Could not finish chunked upload");
    return res.status(500).json({ error: "Upload could not be finished" });
  }
});

router.delete("/uploads/:uploadId", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const uploadId = String(req.params.uploadId);
  const meta = await loadMeta(uploadId, clerkId);
  if (!meta) return res.status(404).json({ error: "Upload not found" });
  await abandon(uploadId, meta);
  return res.status(204).end();
});

async function abandon(uploadId: string, meta: UploadMeta): Promise<void> {
  const paths = [metaPath(uploadId), ...Array.from({ length: meta.totalChunks }, (_, i) => chunkPath(uploadId, i))];
  await Promise.all(paths.map((p) => storage.deleteObjectEntity(p).catch(() => {})));
}

export default router;
