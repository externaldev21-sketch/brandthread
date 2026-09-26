/**
 * Profile cover video — any account type (buyer or seller).
 *
 * POST   /api/profile/cover-video?trimStart=&trimDuration=   raw video body
 *          → { coverVideoUrl, coverPosterUrl, coverVideoUpdatedAt }
 * DELETE /api/profile/cover-video                            → { coverVideoUrl: null, … }
 * GET    /api/profile/cover-video                            → own cover + change-limit status
 * GET    /api/profile/cover-coachmark                        → { seen }
 * POST   /api/profile/cover-coachmark/seen                   → { seen: true }   (idempotent)
 * GET    /api/profile/cover-media/*path                      → public, range-capable stream
 *
 * Follows the post-video pipeline: the upload is validated by magic bytes,
 * written to a temp dir, probed with ffprobe, then ffmpeg renders a
 * compressed, silent (always muted), faststart H.264 rendition plus a poster
 * frame; both go to object storage via ObjectStorageService.
 *
 * Limits (server-enforced — see lib/profileCover.ts):
 *  - ≤30s after the optional trim (probed on the rendered file);
 *  - one change per 24h — setting AND removing both count, so removing
 *    can't be used to cycle covers faster than once a day.
 *
 * Moderation: feed videos have no automated frame moderation in this
 * codebase (text moderation only; videos are handled through reports), so a
 * cover follows the same standard — `cover_video_moderation_status` mirrors
 * posts.moderation_status and a hidden cover is never served or returned.
 */
import express, { Router, type Request } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { db, users } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import {
  COVER_MAX_UPLOAD_BYTES,
  checkCoverChangeAllowed,
  coverDurationError,
  parseTrim,
  type TrimRequest,
} from "../lib/profileCover";

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export interface CoverMediaProcessor {
  probeDuration(path: string): Promise<number>;
  /** Render the silent compressed rendition to `output` and a poster JPEG to `poster`. */
  render(input: string, output: string, poster: string, trim: TrimRequest): Promise<void>;
}

export interface CoverStorage {
  createObjectEntityFromBuffer(bytes: Buffer, contentType: string): Promise<string>;
  trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: "public" | "private" }): Promise<unknown>;
  deleteObjectEntity(path: string): Promise<void>;
}

const exec = promisify(execFile);

export const ffmpegCoverProcessor: CoverMediaProcessor = {
  async probeDuration(path) {
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path,
    ], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    const value = Number.parseFloat(String(stdout).trim());
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid video duration");
    return value;
  },
  async render(input, output, poster, trim) {
    const trimArgs = trim ? ["-ss", String(trim.start), "-t", String(trim.duration)] : [];
    // 720p max on the long edge, no audio track at all (covers are always
    // muted), faststart so playback begins while it streams.
    await exec("ffmpeg", [
      "-y", ...trimArgs, "-i", input,
      "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',fps=30",
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", output,
    ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    await exec("ffmpeg", [
      "-y", "-ss", "0.3", "-i", output, "-frames:v", "1", "-q:v", "3", poster,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  },
};

function isSupportedVideo(contentType: string, bytes: Buffer): boolean {
  if (!VIDEO_TYPES.has(contentType)) return false;
  const isoMedia = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  const webm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return isoMedia || webm;
}

export function coverMediaUrl(req: Request, objectPath: string): string {
  return `${req.protocol}://${req.get("host")}/api/profile/cover-media/${objectPath.replace(/^\/objects\//, "")}`;
}

/** `/objects/<suffix>` for a URL this route issued, or null for anything else. */
export function coverObjectPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/api\/profile\/cover-media\/([A-Za-z0-9._/-]+)$/.exec(url);
  if (!match || match[1].split("/").includes("..")) return null;
  return `/objects/${match[1]}`;
}

function limitResponse(check: Extract<ReturnType<typeof checkCoverChangeAllowed>, { allowed: false }>) {
  return {
    error: check.message,
    code: "cover_change_rate_limited",
    retryAfterHours: check.retryAfterHours,
    retryAfterMs: check.retryAfterMs,
  };
}

async function loadCover(clerkId: string) {
  const [row] = await db.select({
    coverVideoUrl: users.coverVideoUrl,
    coverPosterUrl: users.coverPosterUrl,
    coverVideoUpdatedAt: users.coverVideoUpdatedAt,
    coverVideoModerationStatus: users.coverVideoModerationStatus,
    coverCoachmarkSeenAt: users.coverCoachmarkSeenAt,
  }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return row ?? null;
}

export function createProfileCoverRouter({
  processor = ffmpegCoverProcessor,
  storage = new ObjectStorageService() as unknown as CoverStorage,
  now = () => new Date(),
}: { processor?: CoverMediaProcessor; storage?: CoverStorage; now?: () => Date } = {}) {
  const router = Router();

  router.get("/cover-video", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadCover(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt, now());
    return res.json({
      coverVideoUrl: row.coverVideoUrl,
      coverPosterUrl: row.coverPosterUrl,
      coverVideoUpdatedAt: row.coverVideoUpdatedAt,
      canChange: check.allowed,
      ...(check.allowed ? {} : { retryAfterHours: check.retryAfterHours, message: check.message }),
    });
  });

  router.post(
    "/cover-video",
    requireAuth,
    express.raw({ type: [...VIDEO_TYPES], limit: COVER_MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const clerkId = (req as any).clerkUserId as string;
      const row = await loadCover(clerkId);
      if (!row) return res.status(404).json({ error: "Account not found" });

      // Cheapest check first: the 24h change window.
      const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt, now());
      if (!check.allowed) return res.status(429).json(limitResponse(check));

      const trim = parseTrim(req.query.trimStart, req.query.trimDuration);
      if (trim && "error" in trim) return res.status(400).json({ error: trim.error });

      const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (!VIDEO_TYPES.has(contentType)) return res.status(415).json({ error: "Unsupported video type" });
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) return res.status(400).json({ error: "Video is empty" });
      if (bytes.length > COVER_MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Video is too large" });
      if (!isSupportedVideo(contentType, bytes)) return res.status(400).json({ error: "Invalid video file" });

      const dir = await fs.mkdtemp(join(tmpdir(), "bt-cover-"));
      const created: string[] = [];
      try {
        const input = join(dir, contentType === "video/webm" ? "source.webm" : "source.mp4");
        await fs.writeFile(input, bytes);

        // Without a trim, the source itself must already be ≤30s.
        if (!trim) {
          const sourceError = coverDurationError(await processor.probeDuration(input));
          if (sourceError) return res.status(400).json({ error: sourceError, code: "cover_too_long" });
        }

        const output = join(dir, "cover.mp4");
        const poster = join(dir, "poster.jpg");
        await processor.render(input, output, poster, trim);
        // Re-validate what will actually be served.
        const renderedError = coverDurationError(await processor.probeDuration(output));
        if (renderedError) return res.status(400).json({ error: renderedError, code: "cover_too_long" });

        const videoPath = await storage.createObjectEntityFromBuffer(await fs.readFile(output), "video/mp4");
        created.push(videoPath);
        const posterPath = await storage.createObjectEntityFromBuffer(await fs.readFile(poster), "image/jpeg");
        created.push(posterPath);
        await Promise.all(created.map((path) => storage.trySetObjectEntityAclPolicy(path, { owner: clerkId, visibility: "public" })));

        const updatedAt = now();
        const coverVideoUrl = coverMediaUrl(req, videoPath);
        const coverPosterUrl = coverMediaUrl(req, posterPath);
        // Guard the window again inside the write so two racing uploads can't
        // both land within the same 24h.
        const windowStart = new Date(updatedAt.getTime() - 24 * 60 * 60 * 1000);
        const updated = await db.update(users)
          .set({ coverVideoUrl, coverPosterUrl, coverVideoUpdatedAt: updatedAt, coverVideoModerationStatus: "visible" })
          .where(sql`${users.clerkId} = ${clerkId} AND (${users.coverVideoUpdatedAt} IS NULL OR ${users.coverVideoUpdatedAt} <= ${windowStart})`)
          .returning({ id: users.id });
        if (updated.length === 0) {
          await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
          const again = checkCoverChangeAllowed((await loadCover(clerkId))?.coverVideoUpdatedAt, now());
          return res.status(429).json(again.allowed ? { error: "Please try again", code: "cover_change_rate_limited" } : limitResponse(again));
        }

        // The previous cover's objects are no longer referenced.
        for (const oldPath of [coverObjectPath(row.coverVideoUrl), coverObjectPath(row.coverPosterUrl)]) {
          if (oldPath) await storage.deleteObjectEntity(oldPath).catch(() => {});
        }
        return res.status(201).json({ coverVideoUrl, coverPosterUrl, coverVideoUpdatedAt: updatedAt.toISOString() });
      } catch (err) {
        await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
        req.log?.error?.({ err, clerkId }, "Could not save profile cover video");
        return res.status(500).json({ error: "Cover video could not be saved" });
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  router.delete("/cover-video", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadCover(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    if (!row.coverVideoUrl) return res.json({ coverVideoUrl: null, coverPosterUrl: null, coverVideoUpdatedAt: row.coverVideoUpdatedAt });
    // Removing counts as a change for the 24h limit (documented choice): it
    // is limited by the same window, and it restarts the window.
    const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt, now());
    if (!check.allowed) return res.status(429).json(limitResponse(check));
    const updatedAt = now();
    await db.update(users)
      .set({ coverVideoUrl: null, coverPosterUrl: null, coverVideoUpdatedAt: updatedAt })
      .where(eq(users.clerkId, clerkId));
    for (const oldPath of [coverObjectPath(row.coverVideoUrl), coverObjectPath(row.coverPosterUrl)]) {
      if (oldPath) await storage.deleteObjectEntity(oldPath).catch(() => {});
    }
    return res.json({ coverVideoUrl: null, coverPosterUrl: null, coverVideoUpdatedAt: updatedAt.toISOString() });
  });

  router.get("/cover-coachmark", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadCover(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    return res.json({ seen: !!row.coverCoachmarkSeenAt, hasCover: !!row.coverVideoUrl });
  });

  router.post("/cover-coachmark/seen", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    // Idempotent: the first dismissal's timestamp is kept.
    const updated = await db.update(users)
      .set({ coverCoachmarkSeenAt: sql`COALESCE(${users.coverCoachmarkSeenAt}, now())` })
      .where(eq(users.clerkId, clerkId))
      .returning({ id: users.id });
    if (updated.length === 0) return res.status(404).json({ error: "Account not found" });
    return res.json({ seen: true });
  });

  router.get("/cover-media/*path", async (req, res) => {
    const raw = (req.params as any).path;
    const suffix = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    if (!suffix || suffix.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(suffix)) return res.status(404).end();
    try {
      const mediaSuffix = `%/api/profile/cover-media/${suffix}`;
      const [owner] = await db.select({ status: users.coverVideoModerationStatus })
        .from(users)
        .where(or(sql`${users.coverVideoUrl} LIKE ${mediaSuffix}`, sql`${users.coverPosterUrl} LIKE ${mediaSuffix}`))
        .limit(1);
      if (!owner || owner.status !== "visible") return res.status(404).end();
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

  return router;
}

export default createProfileCoverRouter();
