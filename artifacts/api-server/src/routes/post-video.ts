import express, { Router } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { db, posts, users } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router = Router();
const storage = new ObjectStorageService();
const exec = promisify(execFile);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const FILTERS = new Set(["none", "warm", "cool", "mono"]);
const MAX_CLIP_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_BYTES = 240 * 1024 * 1024;
const MAX_CLIPS = 12;
const MAX_TOTAL_DURATION_SECONDS = 600;
const COMPOSED_PREVIEW_TTL_SECONDS = 60 * 60;
const OBJECT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._/-]+$/;

async function isSeller(clerkId: string): Promise<boolean> {
  const [user] = await db.select({ accountType: users.accountType })
    .from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return user?.accountType === "seller";
}

function validSpeed(value: unknown): value is 0.5 | 1 | 2 | 3 {
  return value === 0.5 || value === 1 || value === 2 || value === 3;
}

function isSupportedVideo(contentType: string, bytes: Buffer): boolean {
  if (!VIDEO_TYPES.has(contentType)) return false;
  const isoMedia = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  const webm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return isoMedia || webm;
}

function validObjectPath(value: unknown): value is string {
  return typeof value === "string" &&
    OBJECT_PATH_RE.test(value) &&
    !value.split("/").includes("..");
}

function audioTempo(speed: 0.5 | 1 | 2 | 3): string {
  return speed === 3 ? "atempo=1.5,atempo=2" : `atempo=${speed}`;
}

async function duration(path: string): Promise<number> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", path,
  ], { timeout: 15_000, maxBuffer: 1024 * 1024 });
  const value = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid video duration");
  return value;
}

async function hasAudio(path: string): Promise<boolean> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=index", "-of", "csv=p=0", path,
  ], { timeout: 15_000, maxBuffer: 1024 * 1024 });
  return String(stdout).trim().length > 0;
}

export function mediaUrl(req: express.Request, path: string): string {
  return `${req.protocol}://${req.get("host")}/api/posts/media/${path.replace(/^\/objects\//, "")}`;
}

export async function setComposedMediaVisibility(
  clerkId: string,
  paths: Array<string | null | undefined>,
  visibility: "private" | "public",
): Promise<void> {
  for (const path of paths.filter((value): value is string => !!value)) {
    const file = await storage.getObjectEntityFile(path);
    const allowed = await storage.canAccessObjectEntity({
      userId: clerkId, objectFile: file, requestedPermission: ObjectPermission.WRITE,
    });
    if (!allowed) throw new Error("Composed media is not owned by this seller");
    await storage.trySetObjectEntityAclPolicy(path, { owner: clerkId, visibility });
  }
}

export async function publishComposedMedia(
  clerkId: string,
  paths: Array<string | null | undefined>,
): Promise<void> {
  return setComposedMediaVisibility(clerkId, paths, "public");
}

router.post(
  "/video-clips",
  requireAuth,
  express.raw({ type: [...VIDEO_TYPES], limit: MAX_CLIP_BYTES }),
  async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    if (!(await isSeller(clerkId))) return res.status(403).json({ error: "Seller account required" });
    const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
    if (!VIDEO_TYPES.has(contentType)) return res.status(415).json({ error: "Unsupported video type" });
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0 || bytes.length > MAX_CLIP_BYTES) {
      return res.status(400).json({ error: "Video clip is empty or too large" });
    }
    if (!isSupportedVideo(contentType, bytes)) {
      return res.status(400).json({ error: "Invalid video file" });
    }
    let objectPath: string | null = null;
    try {
      objectPath = await storage.createObjectEntityFromBuffer(bytes, contentType);
      await storage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkId, visibility: "private" });
      return res.status(201).json({ objectPath, contentType, size: bytes.length });
    } catch (err) {
      if (objectPath) await storage.deleteObjectEntity(objectPath).catch(() => {});
      req.log.error({ err, clerkId }, "Could not upload post video clip");
      return res.status(500).json({ error: "Video clip could not be uploaded" });
    }
  },
);

router.post("/compose-video", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  if (!(await isSeller(clerkId))) return res.status(403).json({ error: "Seller account required" });
  const body = req.body as {
    clips?: Array<{ objectPath?: string; speed?: number; filter?: string }>;
    trimStart?: number;
    trimEnd?: number;
  };
  const clips = body.clips;
  if (!Array.isArray(clips) || clips.length === 0 || clips.length > MAX_CLIPS) {
    return res.status(400).json({ error: `Provide between 1 and ${MAX_CLIPS} clips` });
  }
  if (clips.some(clip => (
    !validObjectPath(clip?.objectPath) ||
    (clip.speed !== undefined && !validSpeed(clip.speed)) ||
    (clip.filter !== undefined && !FILTERS.has(clip.filter))
  ))) return res.status(400).json({ error: "Invalid clip settings" });

  const dir = await fs.mkdtemp(join(tmpdir(), "brandthread-video-"));
  let outputObject: string | null = null;
  let thumbnailObject: string | null = null;
  try {
    const inputs: string[] = [];
    const durations: number[] = [];
    const audio: boolean[] = [];
    let totalBytes = 0;
    for (let index = 0; index < clips.length; index += 1) {
      const file = await storage.getObjectEntityFile(clips[index].objectPath!);
      const allowed = await storage.canAccessObjectEntity({
        userId: clerkId, objectFile: file, requestedPermission: ObjectPermission.WRITE,
      });
      if (!allowed) return res.status(403).json({ error: "A clip is not owned by this seller" });
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_CLIP_BYTES) {
        return res.status(400).json({ error: "A clip is empty or too large" });
      }
      const contentType = String(metadata.contentType ?? "").split(";")[0].toLowerCase();
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) return res.status(400).json({ error: "Combined clips are too large" });
      const path = join(dir, `input-${index}.mp4`);
      const [bytes] = await file.download();
      if (!isSupportedVideo(contentType, bytes)) {
        return res.status(400).json({ error: "A clip is not a supported video file" });
      }
      await fs.writeFile(path, bytes);
      inputs.push(path);
      const clipDuration = await duration(path);
      if (clipDuration > MAX_TOTAL_DURATION_SECONDS) {
        return res.status(400).json({ error: "A clip exceeds the 10 minute duration limit" });
      }
      durations.push(clipDuration);
      audio.push(await hasAudio(path));
    }

    const totalDuration = durations.reduce((sum, seconds, index) => (
      sum + seconds / (validSpeed(clips[index].speed) ? clips[index].speed : 1)
    ), 0);
    if (totalDuration > MAX_TOTAL_DURATION_SECONDS + 0.01) {
      return res.status(400).json({ error: "Combined clips exceed the 10 minute duration limit" });
    }
    const requestedStart = body.trimStart === undefined ? 0 : Number(body.trimStart);
    const requestedEnd = body.trimEnd === undefined ? totalDuration : Number(body.trimEnd);
    if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd)) {
      return res.status(400).json({ error: "Invalid trim range" });
    }
    const start = Math.max(0, requestedStart);
    const end = Math.min(totalDuration, requestedEnd);
    if (
      requestedStart < 0 ||
      requestedEnd > totalDuration + 0.01 ||
      end <= start ||
      end - start > MAX_TOTAL_DURATION_SECONDS + 0.01
    ) {
      return res.status(400).json({ error: "Invalid trim range" });
    }

    const videoFilters = inputs.map((_, index) => {
      const speed = validSpeed(clips[index].speed) ? clips[index].speed : 1;
      const color = clips[index].filter === "warm"
        ? ",eq=saturation=1.12:contrast=1.04:brightness=0.02"
        : clips[index].filter === "cool" ? ",colorbalance=bs=.08"
          : clips[index].filter === "mono" ? ",hue=s=0" : "";
      return `[${index}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30${color},setpts=PTS/${speed}[v${index}]`;
    });
    const audioFilters = inputs.map((_, index) => {
      const speed = validSpeed(clips[index].speed) ? clips[index].speed : 1;
      return audio[index]
        ? `[${index}:a]${audioTempo(speed)},aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`
        : `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${durations[index] / speed}[a${index}]`;
    });
    const concat = inputs.map((_, index) => `[v${index}][a${index}]`).join("");
    const filter = [
      ...videoFilters, ...audioFilters,
      `${concat}concat=n=${inputs.length}:v=1:a=1[combinedv][combineda]`,
      `[combinedv]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[outv]`,
      `[combineda]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[outa]`,
    ].join(";");
    const output = join(dir, "composed.mp4");
    await exec("ffmpeg", [
      "-y", ...inputs.flatMap(path => ["-i", path]),
      "-filter_complex", filter, "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-movflags", "+faststart", output,
    ], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    const outputDuration = await duration(output);
    const thumbnail = join(dir, "thumbnail.jpg");
    await exec("ffmpeg", [
      "-y", "-ss", String(Math.min(0.5, outputDuration / 3)),
      "-i", output, "-frames:v", "1", "-q:v", "2", thumbnail,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    outputObject = await storage.createObjectEntityFromBuffer(await fs.readFile(output), "video/mp4");
    thumbnailObject = await storage.createObjectEntityFromBuffer(await fs.readFile(thumbnail), "image/jpeg");
    await Promise.all([
      storage.trySetObjectEntityAclPolicy(outputObject, { owner: clerkId, visibility: "private" }),
      storage.trySetObjectEntityAclPolicy(thumbnailObject, { owner: clerkId, visibility: "private" }),
    ]);
    const [previewMediaUrl, previewThumbnailUrl] = await Promise.all([
      storage.getObjectEntityDownloadURL(outputObject, COMPOSED_PREVIEW_TTL_SECONDS),
      storage.getObjectEntityDownloadURL(thumbnailObject, COMPOSED_PREVIEW_TTL_SECONDS),
    ]);
    await Promise.all(
      [...new Set(clips.map(clip => clip.objectPath!))]
        .map(path => storage.deleteObjectEntity(path).catch((err) => {
          req.log.warn({ err, clerkId, objectPath: path }, "Could not clean up composed source clip");
        })),
    );
    return res.json({
      mediaUrl: previewMediaUrl,
      mediaPath: outputObject,
      thumbnailUrl: previewThumbnailUrl,
      thumbnailPath: thumbnailObject,
      duration: outputDuration,
      clipCount: clips.length,
    });
  } catch (err) {
    if (outputObject) await storage.deleteObjectEntity(outputObject).catch(() => {});
    if (thumbnailObject) await storage.deleteObjectEntity(thumbnailObject).catch(() => {});
    req.log.error({ err, clerkId }, "Could not compose post video");
    return res.status(500).json({ error: "Video could not be composed" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

router.get("/media/*path", async (req, res) => {
  const raw = req.params.path;
  const suffix = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
  if (!suffix || suffix.includes("..")) return res.status(404).end();
  try {
    const objectPath = `/objects/${suffix}`;
    const mediaSuffix = `%/api/posts/media/${suffix}`;
    const [linkedPost] = await db
      .select({
        userId: posts.userId,
        postStatus: posts.postStatus,
        scheduledAt: posts.scheduledAt,
        visibility: posts.visibility,
      })
      .from(posts)
      .where(or(
        sql`${posts.mediaUrl} LIKE ${mediaSuffix}`,
        sql`${posts.thumbnailUrl} LIKE ${mediaSuffix}`,
      ))
      .limit(1);
    const due = linkedPost?.postStatus === "scheduled" &&
      !!linkedPost.scheduledAt &&
      linkedPost.scheduledAt.getTime() <= Date.now();
    const publiclyVisible = linkedPost?.visibility?.isPublic !== false &&
      (linkedPost?.postStatus === "published" || due);
    if (!linkedPost || !publiclyVisible) return res.status(404).end();

    // Promote a due scheduled object only at its first eligible public read.
    await publishComposedMedia(linkedPost.userId, [objectPath]);
    const file = await storage.getObjectEntityFile(objectPath);
    const allowed = await storage.canAccessObjectEntity({
      objectFile: file, requestedPermission: ObjectPermission.READ,
    });
    if (!allowed) return res.status(404).end();
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (!Number.isSafeInteger(size) || size <= 0) return res.status(404).end();
    const contentType = String(metadata.contentType ?? "application/octet-stream");
    const range = req.get("range");
    let start = 0;
    let end = size - 1;
    let status = 200;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match || (!match[1] && !match[2])) {
        res.setHeader("Content-Range", `bytes */${size}`);
        return res.status(416).end();
      }
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          res.setHeader("Content-Range", `bytes */${size}`);
          return res.status(416).end();
        }
        start = Math.max(0, size - suffixLength);
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= size ||
        end < start
      ) {
        res.setHeader("Content-Range", `bytes */${size}`);
        return res.status(416).end();
      }
      end = Math.min(end, size - 1);
      status = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    }

    res.status(status);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(end - start + 1));
    res.setHeader("Cache-Control", "public, max-age=3600");
    await pipeline(file.createReadStream({ start, end }), res);
    return;
  } catch {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    return res.status(404).end();
  }
});

export default router;