/**
 * Avatar video — a short, always-muted, looping moving profile picture, any
 * account type.
 *
 * POST   /api/profile/avatar-video   raw video body → { avatarVideoUrl, avatarPosterUrl }
 * DELETE /api/profile/avatar-video   → { avatarVideoUrl: null, avatarPosterUrl: null }
 * GET    /api/profile/avatar-video   → own avatar video (or nulls)
 * GET    /api/profile/avatar-media/*path   public, range-capable stream
 *
 * Follows the same pipeline as the profile cover video (see
 * routes/profile-cover.ts): validated by magic bytes, probed with ffprobe,
 * rendered with ffmpeg into a compressed, silent, faststart H.264
 * rendition plus a poster frame, both pushed to object storage. The two
 * differences: the render step center-crops to a square (an avatar is
 * always shown circular/square, never widescreen like the cover), and the
 * duration limit is 10s with no trim endpoint — a clip over the limit is
 * rejected outright rather than offering a trim UI (the client is expected
 * to check the picked asset's duration itself before upload).
 *
 * No once-per-24h change limit — swapping an avatar video is as cheap as
 * swapping an avatar photo.
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
import { MEDIA_REJECTED_MESSAGE, screenVideo } from "../lib/mediaModeration";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import {
  AVATAR_VIDEO_MAX_UPLOAD_BYTES,
  avatarVideoDurationError,
} from "../lib/avatarVideo";
import { acceptUploadSession } from "../lib/uploadSessions";

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export interface AvatarVideoProcessor {
  probeDuration(path: string): Promise<number>;
  /** Render the silent, center-cropped-square rendition to `output` and a poster JPEG to `poster`. */
  render(input: string, output: string, poster: string): Promise<void>;
}

export interface AvatarVideoStorage {
  createObjectEntityFromBuffer(bytes: Buffer, contentType: string): Promise<string>;
  trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: "public" | "private" }): Promise<unknown>;
  deleteObjectEntity(path: string): Promise<void>;
}

const exec = promisify(execFile);

export const ffmpegAvatarVideoProcessor: AvatarVideoProcessor = {
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
    // Center-crop to a square (the shorter side), then scale down to a
    // sensible avatar size — no audio track at all (always muted),
    // faststart so playback begins while it streams.
    const cropExpr = "crop='min(iw,ih)':'min(iw,ih)'";
    await exec("ffmpeg", [
      "-y", "-i", input,
      "-vf", `${cropExpr},scale=480:480,fps=30`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", output,
    ], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    await exec("ffmpeg", [
      "-y", "-ss", "0.1", "-i", output, "-frames:v", "1", "-q:v", "3", poster,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  },
};

function isSupportedVideo(contentType: string, bytes: Buffer): boolean {
  if (!VIDEO_TYPES.has(contentType)) return false;
  const isoMedia = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  const webm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return isoMedia || webm;
}

export function avatarMediaUrl(req: Request, objectPath: string): string {
  return `${req.protocol}://${req.get("host")}/api/profile/avatar-media/${objectPath.replace(/^\/objects\//, "")}`;
}

/** `/objects/<suffix>` for a URL this route issued, or null for anything else. */
export function avatarObjectPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/api\/profile\/avatar-media\/([A-Za-z0-9._/-]+)$/.exec(url);
  if (!match || match[1].split("/").includes("..")) return null;
  return `/objects/${match[1]}`;
}

async function loadAvatarVideo(clerkId: string) {
  const [row] = await db.select({
    avatarVideoUrl: users.avatarVideoUrl,
    avatarPosterUrl: users.avatarPosterUrl,
    avatarVideoUpdatedAt: users.avatarVideoUpdatedAt,
  }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return row ?? null;
}

export function createAvatarVideoRouter({
  processor = ffmpegAvatarVideoProcessor,
  storage = new ObjectStorageService() as unknown as AvatarVideoStorage,
  now = () => new Date(),
}: { processor?: AvatarVideoProcessor; storage?: AvatarVideoStorage; now?: () => Date } = {}) {
  const router = Router();

  router.get("/avatar-video", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadAvatarVideo(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    return res.json({
      avatarVideoUrl: row.avatarVideoUrl,
      avatarPosterUrl: row.avatarPosterUrl,
      avatarVideoUpdatedAt: row.avatarVideoUpdatedAt,
    });
  });

  router.post(
    "/avatar-video",
    requireAuth,
    acceptUploadSession({ allowedTypes: [...VIDEO_TYPES], maxBytes: AVATAR_VIDEO_MAX_UPLOAD_BYTES }),
    express.raw({ type: [...VIDEO_TYPES], limit: AVATAR_VIDEO_MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const clerkId = (req as any).clerkUserId as string;
      const row = await loadAvatarVideo(clerkId);
      if (!row) return res.status(404).json({ error: "Account not found" });

      const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (!VIDEO_TYPES.has(contentType)) return res.status(415).json({ error: "Unsupported video type" });
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) return res.status(400).json({ error: "Video is empty" });
      if (bytes.length > AVATAR_VIDEO_MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Video is too large" });
      if (!isSupportedVideo(contentType, bytes)) return res.status(400).json({ error: "Invalid video file" });

      const dir = await fs.mkdtemp(join(tmpdir(), "bt-avatar-video-"));
      const created: string[] = [];
      try {
        const input = join(dir, contentType === "video/webm" ? "source.webm" : "source.mp4");
        await fs.writeFile(input, bytes);

        const sourceError = avatarVideoDurationError(await processor.probeDuration(input));
        if (sourceError) return res.status(400).json({ error: sourceError, code: "avatar_video_too_long" });

        const output = join(dir, "avatar.mp4");
        const poster = join(dir, "poster.jpg");
        await processor.render(input, output, poster);
        // Re-validate what will actually be served.
        const renderedError = avatarVideoDurationError(await processor.probeDuration(output));
        if (renderedError) return res.status(400).json({ error: renderedError, code: "avatar_video_too_long" });

        // Automatic frame screening (off when the AI integration env is
        // missing). Profile videos have no held state, so flagged ones are
        // refused; a screening outage never blocks the upload.
        const screened = await screenVideo({ buffer: bytes });
        if ((screened.verdict === "hold" && !screened.unverified) || screened.verdict === "reject") {
          void import("../lib/mediaModerationStore").then((m) => m.recordRejectedUpload({ ownerId: clerkId, surface: "avatar_video", verdict: { ...screened, verdict: "reject" } }));
          return res.status(422).json({ error: MEDIA_REJECTED_MESSAGE, code: "IMAGE_REJECTED" });
        }

        const videoPath = await storage.createObjectEntityFromBuffer(await fs.readFile(output), "video/mp4");
        created.push(videoPath);
        const posterPath = await storage.createObjectEntityFromBuffer(await fs.readFile(poster), "image/jpeg");
        created.push(posterPath);
        await Promise.all(created.map((path) => storage.trySetObjectEntityAclPolicy(path, { owner: clerkId, visibility: "public" })));

        const updatedAt = now();
        const avatarVideoUrl = avatarMediaUrl(req, videoPath);
        const avatarPosterUrl = avatarMediaUrl(req, posterPath);
        await db.update(users)
          .set({ avatarVideoUrl, avatarPosterUrl, avatarVideoUpdatedAt: updatedAt })
          .where(eq(users.clerkId, clerkId));

        // The previous avatar video's objects are no longer referenced.
        for (const oldPath of [avatarObjectPath(row.avatarVideoUrl), avatarObjectPath(row.avatarPosterUrl)]) {
          if (oldPath) await storage.deleteObjectEntity(oldPath).catch(() => {});
        }
        return res.status(201).json({ avatarVideoUrl, avatarPosterUrl, avatarVideoUpdatedAt: updatedAt.toISOString() });
      } catch (err) {
        await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
        req.log?.error?.({ err, clerkId }, "Could not save avatar video");
        return res.status(500).json({ error: "Avatar video could not be saved" });
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  router.delete("/avatar-video", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadAvatarVideo(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    if (!row.avatarVideoUrl) return res.json({ avatarVideoUrl: null, avatarPosterUrl: null });
    await db.update(users)
      .set({ avatarVideoUrl: null, avatarPosterUrl: null, avatarVideoUpdatedAt: now() })
      .where(eq(users.clerkId, clerkId));
    for (const oldPath of [avatarObjectPath(row.avatarVideoUrl), avatarObjectPath(row.avatarPosterUrl)]) {
      if (oldPath) await storage.deleteObjectEntity(oldPath).catch(() => {});
    }
    return res.json({ avatarVideoUrl: null, avatarPosterUrl: null });
  });

  router.get("/avatar-media/*path", async (req, res) => {
    const raw = (req.params as any).path;
    const suffix = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    if (!suffix || suffix.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(suffix)) return res.status(404).end();
    try {
      const mediaSuffix = `%/api/profile/avatar-media/${suffix}`;
      const [owner] = await db.select({ id: users.id })
        .from(users)
        .where(or(sql`${users.avatarVideoUrl} LIKE ${mediaSuffix}`, sql`${users.avatarPosterUrl} LIKE ${mediaSuffix}`))
        .limit(1);
      if (!owner) return res.status(404).end();
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

export default createAvatarVideoRouter();
