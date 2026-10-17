/**
 * Profile cover video — any account type (buyer or seller).
 *
 * POST   /api/profile/cover-video?trimStart=&trimDuration=&cropX=&cropY=&cropW=&cropH=
 *          raw video body → { coverVideoUrl, coverPosterUrl, coverVideoUpdatedAt, profileBanner }
 * POST   /api/profile/cover-gif?cropX=&cropY=&cropW=&cropH=     raw image/gif body (≤15MB)
 *          → { coverVideoUrl, coverPosterUrl, coverGifUrl, coverVideoUpdatedAt, profileBanner }
 * POST   /api/profile/cover-video/from-upload  { objectPath, trimStart, trimDuration, cropX… }
 *          any-length clip already sent through the chunked post upload → same as above
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
 * The cover is the profile banner (TikTok-style): a looping muted video OR a
 * GIF. Uploading one replaces the other. A GIF is converted to a looping,
 * silent MP4 (smaller and smoother than the GIF itself) with a poster frame;
 * the original GIF is kept as the fallback. The optional crop is the banner
 * crop screen's normalized rect, applied here by ffmpeg so every client gets
 * the same framing.
 *
 * Limits (server-enforced — see lib/profileCover.ts):
 *  - ≤10s after the optional trim (the client's trim screen picks the 10s
 *    window; probed on the rendered file);
 *  - one change per 24h — setting AND removing both count, so removing
 *    can't be used to cycle covers faster than once a day.
 *
 * Moderation: feed videos have no automated frame moderation in this
 * codebase (text moderation only; videos are handled through reports), so a
 * cover follows the same standard — `cover_video_moderation_status` mirrors
 * posts.moderation_status and a hidden cover is never served or returned.
 */
import express, { Router, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { disconnectSafeStorageStream } from "../lib/disconnectSafeStorageStream";
import { promisify } from "node:util";
import { db, users } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { MEDIA_REJECTED_MESSAGE, screenVideo } from "../lib/mediaModeration";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { redirectToPublicMedia } from "../lib/mediaDelivery";
import { ObjectPermission } from "../lib/objectAcl";
import { longEdgeFilter, renderSilentRendition } from "../lib/mediaQuality";
import {
  COVER_GIF_MAX_BYTES,
  COVER_MAX_UPLOAD_BYTES,
  checkCoverChangeAllowed,
  coverDurationError,
  parseCrop,
  parseTrim,
  profileBannerFromRow,
  type CropRequest,
  type TrimRequest,
} from "../lib/profileCover";
import { acceptUploadSession } from "../lib/uploadSessions";

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export interface CoverMediaProcessor {
  probeDuration(path: string): Promise<number>;
  /** Render the silent compressed rendition to `output` and a poster JPEG to `poster`. */
  render(input: string, output: string, poster: string, trim: TrimRequest, crop?: CropRequest): Promise<void>;
  /** Convert a GIF to a looping silent MP4 at `output` plus its first frame as a poster JPEG. */
  renderGif(input: string, output: string, poster: string, crop: CropRequest): Promise<void>;
}

function cropFilterFor(crop: CropRequest | undefined): string {
  return crop
    ? `crop=trunc(iw*${crop.width}/2)*2:trunc(ih*${crop.height}/2)*2:trunc(iw*${crop.x}):trunc(ih*${crop.y}),`
    : "";
}
/** ≤1280 on the long edge, even dimensions (yuv420p), constant 30fps so loops have no hitch. */
const SCALE_FILTER = "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30";

export interface CoverStorage {
  createObjectEntityFromBuffer(bytes: Buffer, contentType: string): Promise<string>;
  trySetObjectEntityAclPolicy(path: string, policy: { owner: string; visibility: "public" | "private" }): Promise<unknown>;
  deleteObjectEntity(path: string): Promise<void>;
}

/** A finished chunked upload (`/api/posts/uploads`) to render a long clip from. */
export interface CoverUploadSource {
  /** Download `objectPath` to `destination` if `owner` owns it; null when missing or not theirs. */
  download(objectPath: string, owner: string, destination: string): Promise<{ contentType: string; size: number } | null>;
  remove(objectPath: string): Promise<void>;
}

/** Hard ceiling for a long source (the chunked upload's own limit is 1GB). */
export const COVER_SOURCE_MAX_BYTES = 1024 * 1024 * 1024;

export const objectStorageCoverUploads: CoverUploadSource = {
  async download(objectPath, owner, destination) {
    const objectStorage = new ObjectStorageService();
    let file;
    try { file = await objectStorage.getObjectEntityFile(objectPath); } catch { return null; }
    const allowed = await objectStorage.canAccessObjectEntity({ userId: owner, objectFile: file, requestedPermission: ObjectPermission.WRITE });
    if (!allowed) return null;
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (!Number.isFinite(size) || size <= 0 || size > COVER_SOURCE_MAX_BYTES) return null;
    // Stream to disk: a long clip can be hundreds of MB.
    await file.download({ destination });
    return { contentType: String(metadata.contentType ?? "").split(";")[0].toLowerCase(), size };
  },
  async remove(objectPath) {
    await new ObjectStorageService().deleteObjectEntity(objectPath);
  },
};

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
  async render(input, output, poster, trim, crop) {
    const trimArgs = trim ? ["-ss", String(trim.start), "-t", String(trim.duration)] : [];
    // 1080p (1920 long edge) max, downscale only, source fps, no audio track
    // at all (covers are always muted), faststart so playback begins while it
    // streams. Was 1280 / crf 28 / 30 fps — visibly soft full-bleed.
    await renderSilentRendition({
      input, output, poster, inputArgs: trimArgs, scale: `${cropFilterFor(crop)}${longEdgeFilter()}`, posterOffset: 0.3,
    });
  },
  async renderGif(input, output, poster, crop) {
    await exec("ffmpeg", [
      "-y", "-i", input,
      "-vf", `${cropFilterFor(crop)}${SCALE_FILTER}`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", output,
    ], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
    // The poster is the very first frame, so the loop restarts on what was shown first.
    await exec("ffmpeg", [
      "-y", "-i", output, "-frames:v", "1", "-q:v", "3", poster,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  },
};

function isGif(bytes: Buffer): boolean {
  const header = bytes.subarray(0, 6).toString("ascii");
  return header === "GIF87a" || header === "GIF89a";
}

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
    coverImageUrl: users.coverImageUrl,
    coverMediaType: users.coverMediaType,
    coverVideoUpdatedAt: users.coverVideoUpdatedAt,
    coverVideoModerationStatus: users.coverVideoModerationStatus,
    coverCoachmarkSeenAt: users.coverCoachmarkSeenAt,
  }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return row ?? null;
}

/** Every stored object the current cover references (video, poster, image). */
function coverObjectPaths(row: { coverVideoUrl?: string | null; coverPosterUrl?: string | null; coverImageUrl?: string | null }): string[] {
  return [row.coverVideoUrl, row.coverPosterUrl, row.coverImageUrl]
    .map((url) => coverObjectPath(url))
    .filter((path, index, all): path is string => !!path && all.indexOf(path) === index);
}

export function createProfileCoverRouter({
  processor = ffmpegCoverProcessor,
  storage = new ObjectStorageService() as unknown as CoverStorage,
  uploads = objectStorageCoverUploads,
  now = () => new Date(),
}: { processor?: CoverMediaProcessor; storage?: CoverStorage; uploads?: CoverUploadSource; now?: () => Date } = {}) {
  const router = Router();

  /**
   * Shared tail of both video routes: the source is on disk at `input`.
   * Enforces ≤10s (source without a trim, and always the rendered file),
   * renders the trimmed + cropped silent loop and poster, screens it, stores
   * both publicly and swaps them in under the 24h window guard.
   */
  async function saveVideoCover(
    req: Request,
    res: Response,
    { clerkId, row, dir, input, trim, crop }: {
      clerkId: string;
      row: NonNullable<Awaited<ReturnType<typeof loadCover>>>;
      dir: string;
      input: string;
      trim: TrimRequest;
      crop: CropRequest | undefined;
    },
  ) {
    const created: string[] = [];
    try {
      // Without a trim, the source itself must already be ≤10s (the
      // client's trim screen sends the chosen window for longer clips).
      if (!trim) {
        const sourceError = coverDurationError(await processor.probeDuration(input));
        if (sourceError) return res.status(400).json({ error: sourceError, code: "cover_too_long" });
      }

      const output = join(dir, "cover.mp4");
      const poster = join(dir, "poster.jpg");
      await processor.render(input, output, poster, trim, crop);
      // Re-validate what will actually be served.
      const renderedError = coverDurationError(await processor.probeDuration(output));
      if (renderedError) return res.status(400).json({ error: renderedError, code: "cover_too_long" });
      const rendered = await fs.readFile(output);

      // Automatic frame screening (off when the AI integration env is
      // missing) of what will be served. Profile videos have no held state,
      // so flagged ones are refused; a screening outage never blocks the upload.
      const screened = await screenVideo({ buffer: rendered });
      if ((screened.verdict === "hold" && !screened.unverified) || screened.verdict === "reject") {
        void import("../lib/mediaModerationStore").then((m) => m.recordRejectedUpload({ ownerId: clerkId, surface: "cover_video", verdict: { ...screened, verdict: "reject" } }));
        return res.status(422).json({ error: MEDIA_REJECTED_MESSAGE, code: "IMAGE_REJECTED" });
      }

      const videoPath = await storage.createObjectEntityFromBuffer(rendered, "video/mp4");
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
        .set({ coverVideoUrl, coverPosterUrl, coverImageUrl: null, coverMediaType: "video", coverVideoUpdatedAt: updatedAt, coverVideoModerationStatus: "visible" })
        .where(sql`${users.clerkId} = ${clerkId} AND (${users.coverVideoUpdatedAt} IS NULL OR ${users.coverVideoUpdatedAt} <= ${windowStart})`)
        .returning({ id: users.id });
      if (updated.length === 0) {
        await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
        const again = checkCoverChangeAllowed((await loadCover(clerkId))?.coverVideoUpdatedAt, now());
        return res.status(429).json(again.allowed ? { error: "Please try again", code: "cover_change_rate_limited" } : limitResponse(again));
      }

      // The previous cover's objects are no longer referenced.
      for (const oldPath of coverObjectPaths(row)) await storage.deleteObjectEntity(oldPath).catch(() => {});
      return res.status(201).json({
        coverVideoUrl,
        coverPosterUrl,
        coverVideoUpdatedAt: updatedAt.toISOString(),
        profileBanner: { type: "video", url: coverVideoUrl, posterUrl: coverPosterUrl },
      });
    } catch (err) {
      await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
      req.log?.error?.({ err, clerkId }, "Could not save profile cover video");
      return res.status(500).json({ error: "Cover video could not be saved" });
    }
  }

  router.get("/cover-video", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadCover(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt, now());
    return res.json({
      coverVideoUrl: row.coverVideoUrl,
      coverPosterUrl: row.coverPosterUrl,
      coverVideoUpdatedAt: row.coverVideoUpdatedAt,
      profileBanner: profileBannerFromRow(row),
      canChange: check.allowed,
      ...(check.allowed ? {} : { retryAfterHours: check.retryAfterHours, message: check.message }),
    });
  });

  router.post(
    "/cover-video",
    requireAuth,
    acceptUploadSession({ allowedTypes: [...VIDEO_TYPES], maxBytes: COVER_MAX_UPLOAD_BYTES }),
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
      const crop = parseCrop(req.query.cropX, req.query.cropY, req.query.cropW, req.query.cropH);
      if (crop && "error" in crop) return res.status(400).json({ error: crop.error });

      const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (!VIDEO_TYPES.has(contentType)) return res.status(415).json({ error: "Unsupported video type" });
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) return res.status(400).json({ error: "Video is empty" });
      if (bytes.length > COVER_MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Video is too large" });
      if (!isSupportedVideo(contentType, bytes)) return res.status(400).json({ error: "Invalid video file" });

      const dir = await fs.mkdtemp(join(tmpdir(), "bt-cover-"));
      try {
        const input = join(dir, contentType === "video/webm" ? "source.webm" : "source.mp4");
        await fs.writeFile(input, bytes);
        return await saveVideoCover(req, res, { clerkId, row, dir, input, trim, crop });
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  // Any-length clip (the trim screen's 10s window of a long video): the
  // source goes up through the chunked post upload (/api/posts/uploads,
  // private, owned by the uploader) and is rendered here from storage, so the
  // phone never has to send one huge request body. The source object is
  // deleted once the banner is saved (or refused).
  router.post("/cover-video/from-upload", requireAuth, express.json(), async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath : "";
    if (!/^\/objects\/uploads\/[A-Za-z0-9._-]+$/.test(objectPath)) return res.status(400).json({ error: "Upload not found" });
    const row = await loadCover(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });

    const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt, now());
    if (!check.allowed) return res.status(429).json(limitResponse(check));

    const trim = parseTrim(req.body?.trimStart, req.body?.trimDuration);
    if (trim && "error" in trim) return res.status(400).json({ error: trim.error });
    const crop = parseCrop(req.body?.cropX, req.body?.cropY, req.body?.cropW, req.body?.cropH);
    if (crop && "error" in crop) return res.status(400).json({ error: crop.error });

    const dir = await fs.mkdtemp(join(tmpdir(), "bt-cover-long-"));
    let owned = false;
    try {
      const input = join(dir, "source");
      const fetched = await uploads.download(objectPath, clerkId, input);
      if (!fetched) return res.status(404).json({ error: "Upload not found" });
      owned = true;
      const handle = await fs.open(input, "r");
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0).catch(() => undefined);
      await handle.close();
      if (!isSupportedVideo(fetched.contentType, head)) return res.status(400).json({ error: "Invalid video file" });
      return await saveVideoCover(req, res, { clerkId, row, dir, input, trim, crop });
    } catch (err) {
      req.log?.error?.({ err, clerkId }, "Could not read the uploaded cover source");
      return res.status(500).json({ error: "Cover video could not be saved" });
    } finally {
      if (owned) await uploads.remove(objectPath).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // GIF banner — same 24h window, storage, ACL and moderation path as the
  // video. Converted to a looping silent MP4 (+ poster); the original GIF is
  // stored too as the fallback. Replaces a video banner (and vice versa).
  router.post(
    "/cover-gif",
    requireAuth,
    express.raw({ type: ["image/gif"], limit: COVER_GIF_MAX_BYTES }),
    async (req, res) => {
      const clerkId = (req as any).clerkUserId as string;
      const row = await loadCover(clerkId);
      if (!row) return res.status(404).json({ error: "Account not found" });

      const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt, now());
      if (!check.allowed) return res.status(429).json(limitResponse(check));

      const crop = parseCrop(req.query.cropX, req.query.cropY, req.query.cropW, req.query.cropH);
      if (crop && "error" in crop) return res.status(400).json({ error: crop.error });

      const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (contentType !== "image/gif") return res.status(415).json({ error: "Choose a GIF" });
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) return res.status(400).json({ error: "GIF is empty" });
      if (bytes.length > COVER_GIF_MAX_BYTES) return res.status(413).json({ error: "GIFs can be at most 15MB" });
      if (!isGif(bytes)) return res.status(400).json({ error: "Invalid GIF file" });

      const dir = await fs.mkdtemp(join(tmpdir(), "bt-cover-gif-"));
      const created: string[] = [];
      try {
        const input = join(dir, "source.gif");
        await fs.writeFile(input, bytes);
        const output = join(dir, "cover.mp4");
        const poster = join(dir, "poster.jpg");
        // A GIF that ffmpeg can't convert still works as a banner: the
        // original plays as is (expo-image animates GIFs).
        let converted = true;
        try {
          await processor.renderGif(input, output, poster, crop);
        } catch (err) {
          converted = false;
          req.log?.warn?.({ err, clerkId }, "GIF banner conversion failed; serving the original GIF");
        }

        const screened = await screenVideo({ buffer: converted ? await fs.readFile(output) : bytes });
        if ((screened.verdict === "hold" && !screened.unverified) || screened.verdict === "reject") {
          void import("../lib/mediaModerationStore").then((m) => m.recordRejectedUpload({ ownerId: clerkId, surface: "cover_gif", verdict: { ...screened, verdict: "reject" } }));
          return res.status(422).json({ error: MEDIA_REJECTED_MESSAGE, code: "IMAGE_REJECTED" });
        }

        const gifPath = await storage.createObjectEntityFromBuffer(bytes, "image/gif");
        created.push(gifPath);
        let videoPath: string | null = null;
        let posterPath: string | null = null;
        if (converted) {
          videoPath = await storage.createObjectEntityFromBuffer(await fs.readFile(output), "video/mp4");
          created.push(videoPath);
          posterPath = await storage.createObjectEntityFromBuffer(await fs.readFile(poster), "image/jpeg");
          created.push(posterPath);
        }
        await Promise.all(created.map((path) => storage.trySetObjectEntityAclPolicy(path, { owner: clerkId, visibility: "public" })));

        const updatedAt = now();
        const coverGifUrl = coverMediaUrl(req, gifPath);
        const coverVideoUrl = videoPath ? coverMediaUrl(req, videoPath) : null;
        const coverPosterUrl = posterPath ? coverMediaUrl(req, posterPath) : null;
        const windowStart = new Date(updatedAt.getTime() - 24 * 60 * 60 * 1000);
        const updated = await db.update(users)
          .set({
            coverImageUrl: coverGifUrl,
            coverMediaType: "gif",
            coverVideoUrl,
            coverPosterUrl,
            coverVideoUpdatedAt: updatedAt,
            coverVideoModerationStatus: "visible",
          })
          .where(sql`${users.clerkId} = ${clerkId} AND (${users.coverVideoUpdatedAt} IS NULL OR ${users.coverVideoUpdatedAt} <= ${windowStart})`)
          .returning({ id: users.id });
        if (updated.length === 0) {
          await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
          const again = checkCoverChangeAllowed((await loadCover(clerkId))?.coverVideoUpdatedAt, now());
          return res.status(429).json(again.allowed ? { error: "Please try again", code: "cover_change_rate_limited" } : limitResponse(again));
        }

        for (const oldPath of coverObjectPaths(row)) await storage.deleteObjectEntity(oldPath).catch(() => {});
        return res.status(201).json({
          coverVideoUrl,
          coverPosterUrl,
          coverGifUrl,
          coverVideoUpdatedAt: updatedAt.toISOString(),
          profileBanner: { type: "gif", url: coverVideoUrl ?? coverGifUrl, posterUrl: coverPosterUrl, gifUrl: coverGifUrl },
        });
      } catch (err) {
        await Promise.all(created.map((path) => storage.deleteObjectEntity(path).catch(() => {})));
        req.log?.error?.({ err, clerkId }, "Could not save profile banner GIF");
        return res.status(500).json({ error: "Banner could not be saved" });
      } finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  router.delete("/cover-video", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadCover(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    if (!profileBannerFromRow(row)) return res.json({ coverVideoUrl: null, coverPosterUrl: null, coverVideoUpdatedAt: row.coverVideoUpdatedAt, profileBanner: null });
    // Removing counts as a change for the 24h limit (documented choice): it
    // is limited by the same window, and it restarts the window.
    const check = checkCoverChangeAllowed(row.coverVideoUpdatedAt, now());
    if (!check.allowed) return res.status(429).json(limitResponse(check));
    const updatedAt = now();
    await db.update(users)
      .set({ coverVideoUrl: null, coverPosterUrl: null, coverImageUrl: null, coverMediaType: null, coverVideoUpdatedAt: updatedAt })
      .where(eq(users.clerkId, clerkId));
    for (const oldPath of coverObjectPaths(row)) await storage.deleteObjectEntity(oldPath).catch(() => {});
    return res.json({ coverVideoUrl: null, coverPosterUrl: null, coverVideoUpdatedAt: updatedAt.toISOString(), profileBanner: null });
  });

  router.get("/cover-coachmark", requireAuth, async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    const row = await loadCover(clerkId);
    if (!row) return res.status(404).json({ error: "Account not found" });
    return res.json({ seen: !!row.coverCoachmarkSeenAt, hasCover: !!profileBannerFromRow(row) });
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
        .where(or(
          sql`${users.coverVideoUrl} LIKE ${mediaSuffix}`,
          sql`${users.coverPosterUrl} LIKE ${mediaSuffix}`,
          sql`${users.coverImageUrl} LIKE ${mediaSuffix}`,
        ))
        .limit(1);
      if (!owner || owner.status !== "visible") return res.status(404).end();
      const objectStorage = new ObjectStorageService();
      const file = await objectStorage.getObjectEntityFile(`/objects/${suffix}`);
      const allowed = await objectStorage.canAccessObjectEntity({ objectFile: file, requestedPermission: ObjectPermission.READ });
      if (!allowed) return res.status(404).end();
      if (await redirectToPublicMedia(res, `/objects/${suffix}`)) return; // CDN / signed URL, not Express (BT-473)
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
      await pipeline(disconnectSafeStorageStream(file.createReadStream({ start, end })), res);
      return;
    } catch {
      if (res.headersSent) { res.destroy(); return; }
      return res.status(404).end();
    }
  });

  return router;
}

export default createProfileCoverRouter();
