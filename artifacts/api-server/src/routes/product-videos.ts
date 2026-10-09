/**
 * Product video — one short silent video per product, shown under the
 * product-page gallery.
 *
 * Public (no auth):
 *   GET    /api/product-videos/public/:productId   → { video: { videoUrl, posterUrl, durationMs } | null }
 *   GET    /api/product-videos/media/*path         → range-capable stream (only for live, active products)
 *
 * Seller (auth; writes need the manager role, scoped to the team store owner):
 *   GET    /api/product-videos/:productId          → { video | null }
 *   POST   /api/product-videos/:productId          → raw video body (mp4 / mov / webm, ≤100 MB, ≤60 s)
 *   DELETE /api/product-videos/:productId
 *
 * Modelled on the profile cover-video pipeline (routes/profile-cover.ts): the
 * upload is validated by declared type + magic bytes, probed with ffprobe,
 * re-encoded by ffmpeg into a compressed, silent, faststart H.264 rendition
 * plus a poster frame, and both are written to object storage with a public
 * ACL (served through the media route, which checks the row is still live).
 */
import express, { Router, type Request } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { db, products, productVideos } from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { isUuid } from "../lib/productPairings";
import {
  PRODUCT_VIDEO_MAX_UPLOAD_BYTES,
  PRODUCT_VIDEO_TYPES,
  isSupportedProductVideo,
  productVideoDurationError,
} from "../lib/productVideo";
import { acceptUploadSession } from "../lib/uploadSessions";

export interface ProductVideoProcessor {
  probeDuration(path: string): Promise<number>;
  /** Render the silent compressed rendition to `output` and a poster JPEG to `poster`. */
  render(input: string, output: string, poster: string): Promise<void>;
}

export interface ProductVideoStorage {
  createObjectEntityFromBuffer(bytes: Buffer, contentType: string): Promise<string>;
  trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: "public" | "private" }): Promise<unknown>;
  deleteObjectEntity(path: string): Promise<void>;
}

const exec = promisify(execFile);

export const ffmpegProductVideoProcessor: ProductVideoProcessor = {
  async probeDuration(path) {
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path,
    ], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    const value = Number.parseFloat(String(stdout).trim());
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid video duration");
    return value;
  },
  async render(input, output, poster) {
    await exec("ffmpeg", [
      "-y", "-i", input,
      "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',fps=30",
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", output,
    ], { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
    await exec("ffmpeg", [
      "-y", "-ss", "0.3", "-i", output, "-frames:v", "1", "-q:v", "3", poster,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  },
};

export function productVideoMediaUrl(req: Request, objectPath: string): string {
  return `${req.protocol}://${req.get("host")}/api/product-videos/media/${objectPath.replace(/^\/objects\//, "")}`;
}

/** `/objects/<suffix>` for a URL this route issued, or null for anything else. */
export function productVideoObjectPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/api\/product-videos\/media\/([A-Za-z0-9._/-]+)$/.exec(url);
  if (!match || match[1].split("/").includes("..")) return null;
  return `/objects/${match[1]}`;
}

function publicShape(row: { videoUrl: string; posterUrl: string | null; durationMs: number | null }) {
  return { videoUrl: row.videoUrl, posterUrl: row.posterUrl, durationMs: row.durationMs };
}

export function createProductVideosRouter({
  processor = ffmpegProductVideoProcessor,
  storage = new ObjectStorageService() as unknown as ProductVideoStorage,
}: { processor?: ProductVideoProcessor; storage?: ProductVideoStorage } = {}) {
  const router = Router();

  // ── Public ─────────────────────────────────────────────────────────────────

  router.get("/public/:productId", async (req, res) => {
    const { productId } = req.params;
    if (!isUuid(productId)) { res.json({ video: null }); return; }
    try {
      setPublicCacheHeaders(res);
      const [row] = await db
        .select({ videoUrl: productVideos.videoUrl, posterUrl: productVideos.posterUrl, durationMs: productVideos.durationMs })
        .from(productVideos)
        .innerJoin(products, eq(products.id, productVideos.productId))
        .where(and(eq(productVideos.productId, productId), eq(products.status, "active"), isNull(products.deletedAt)))
        .limit(1);
      res.json({ video: row ? publicShape(row) : null });
    } catch (err) {
      req.log?.error?.({ err, productId }, "Failed to fetch product video");
      res.status(500).json({ error: "Failed to fetch product video" });
    }
  });

  router.get("/media/*path", async (req, res) => {
    const raw = (req.params as any).path;
    const suffix = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    if (!suffix || suffix.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(suffix)) return res.status(404).end();
    try {
      const mediaSuffix = `%/api/product-videos/media/${suffix}`;
      const [live] = await db.select({ productId: productVideos.productId })
        .from(productVideos)
        .innerJoin(products, eq(products.id, productVideos.productId))
        .where(and(
          or(sql`${productVideos.videoUrl} LIKE ${mediaSuffix}`, sql`${productVideos.posterUrl} LIKE ${mediaSuffix}`),
          eq(products.status, "active"),
          isNull(products.deletedAt),
        ))
        .limit(1);
      if (!live) return res.status(404).end();
      const objectStorage = new ObjectStorageService();
      const file = await objectStorage.getObjectEntityFile(`/objects/${suffix}`);
      const allowed = await objectStorage.canAccessObjectEntity({ objectFile: file, requestedPermission: ObjectPermission.READ });
      if (!allowed) return res.status(404).end();
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (!Number.isSafeInteger(size) || size <= 0) return res.status(404).end();
      let start = 0;
      let end = size - 1;
      const range = req.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (!match || (!match[1] && !match[2])) {
          res.setHeader("Content-Range", `bytes */${size}`);
          return res.status(416).end();
        }
        if (!match[1]) start = Math.max(0, size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Number(match[2]); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
          res.setHeader("Content-Range", `bytes */${size}`);
          return res.status(416).end();
        }
        end = Math.min(end, size - 1);
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", String(metadata.contentType ?? "application/octet-stream"));
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Cache-Control", "public, max-age=3600");
      await pipeline(file.createReadStream({ start, end }), res);
      return;
    } catch {
      if (res.headersSent) { res.destroy(); return; }
      return res.status(404).end();
    }
  });

  // ── Seller ─────────────────────────────────────────────────────────────────

  router.use(requireAuth);
  router.use(teamContext());

  async function ownProduct(ownerId: string, productId: string) {
    if (!isUuid(productId)) return null;
    const [product] = await db.select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
      .limit(1);
    return product ?? null;
  }

  router.get("/:productId", async (req, res) => {
    const ownerId = (req as any).clerkUserId as string;
    const product = await ownProduct(ownerId, req.params.productId);
    if (!product) return res.status(404).json({ error: "Product not found" });
    const [row] = await db.select().from(productVideos).where(eq(productVideos.productId, product.id)).limit(1);
    return res.json({ video: row ? publicShape(row) : null });
  });

  router.post(
    "/:productId",
    requireRole("manager"),
    acceptUploadSession({ allowedTypes: [...PRODUCT_VIDEO_TYPES], maxBytes: PRODUCT_VIDEO_MAX_UPLOAD_BYTES }),
    express.raw({ type: [...PRODUCT_VIDEO_TYPES], limit: PRODUCT_VIDEO_MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const ownerId = (req as any).clerkUserId as string;
      const product = await ownProduct(ownerId, req.params.productId);
      if (!product) return res.status(404).json({ error: "Product not found" });

      const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (!PRODUCT_VIDEO_TYPES.has(contentType)) return res.status(415).json({ error: "Use an MP4, MOV or WebM video" });
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) return res.status(400).json({ error: "Video is empty" });
      if (bytes.length > PRODUCT_VIDEO_MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Video is too large" });
      if (!isSupportedProductVideo(contentType, bytes)) return res.status(400).json({ error: "Invalid video file" });

      const dir = await fs.mkdtemp(join(tmpdir(), "bt-product-video-"));
      const created: string[] = [];
      try {
        const input = join(dir, contentType === "video/webm" ? "source.webm" : "source.mp4");
        await fs.writeFile(input, bytes);

        const sourceError = productVideoDurationError(await processor.probeDuration(input));
        if (sourceError) return res.status(400).json({ error: sourceError, code: "video_too_long" });

        const output = join(dir, "product.mp4");
        const poster = join(dir, "poster.jpg");
        await processor.render(input, output, poster);
        const renderedSeconds = await processor.probeDuration(output);
        const renderedError = productVideoDurationError(renderedSeconds);
        if (renderedError) return res.status(400).json({ error: renderedError, code: "video_too_long" });

        const videoPath = await storage.createObjectEntityFromBuffer(await fs.readFile(output), "video/mp4");
        created.push(videoPath);
        const posterPath = await storage.createObjectEntityFromBuffer(await fs.readFile(poster), "image/jpeg");
        created.push(posterPath);
        await Promise.all(created.map((path) => storage.trySetObjectEntityAclPolicy(path, { owner: ownerId, visibility: "public" })));

        const [previous] = await db.select().from(productVideos).where(eq(productVideos.productId, product.id)).limit(1);
        const values = {
          videoUrl: productVideoMediaUrl(req, videoPath),
          posterUrl: productVideoMediaUrl(req, posterPath),
          durationMs: Math.round(renderedSeconds * 1000),
        };
        await db.insert(productVideos)
          .values({ productId: product.id, ...values })
          .onConflictDoUpdate({ target: productVideos.productId, set: { ...values, createdAt: new Date() } });

        // The replaced video's objects are no longer referenced.
        for (const oldPath of [productVideoObjectPath(previous?.videoUrl), productVideoObjectPath(previous?.posterUrl)]) {
          if (oldPath) await storage.deleteObjectEntity(oldPath).catch(() => {});
        }
        return res.status(201).json({ video: publicShape({ ...values }) });
      } catch (err) {
        await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
        req.log?.error?.({ err, productId: product.id }, "Could not save product video");
        return res.status(500).json({ error: "Video could not be saved" });
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  router.delete("/:productId", requireRole("manager"), async (req, res) => {
    const ownerId = (req as any).clerkUserId as string;
    const product = await ownProduct(ownerId, req.params.productId);
    if (!product) return res.status(404).json({ error: "Product not found" });
    const [removed] = await db.delete(productVideos).where(eq(productVideos.productId, product.id)).returning();
    for (const oldPath of [productVideoObjectPath(removed?.videoUrl), productVideoObjectPath(removed?.posterUrl)]) {
      if (oldPath) await storage.deleteObjectEntity(oldPath).catch(() => {});
    }
    return res.json({ video: null });
  });

  return router;
}

export default createProductVideosRouter();
