import express, { Router } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
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

async function isSeller(clerkId: string): Promise<boolean> {
  const [user] = await db.select({ accountType: users.accountType })
    .from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return user?.accountType === "seller";
}

function validSpeed(value: unknown): value is 0.5 | 1 | 2 | 3 {
  return value === 0.5 || value === 1 || value === 2 || value === 3;
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

function mediaUrl(req: express.Request, path: string): string {
  return `${req.protocol}://${req.get("host")}/api/posts/media/${path.replace(/^\/objects\//, "")}`;
}

export async function publishComposedMedia(
  clerkId: string,
  paths: Array<string | null | undefined>,
): Promise<void> {
  for (const path of paths.filter((value): value is string => !!value)) {
    const file = await storage.getObjectEntityFile(path);
    const allowed = await storage.canAccessObjectEntity({
      userId: clerkId, objectFile: file, requestedPermission: ObjectPermission.WRITE,
    });
    if (!allowed) throw new Error("Composed media is not owned by this seller");
    await storage.trySetObjectEntityAclPolicy(path, { owner: clerkId, visibility: "public" });
  }
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
    const isoMedia = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
    const webm = bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!isoMedia && !webm) return res.status(400).json({ error: "Invalid video file" });
    try {
      const objectPath = await storage.createObjectEntityFromBuffer(bytes, contentType);
      await storage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkId, visibility: "private" });
      return res.status(201).json({ objectPath, contentType, size: bytes.length });
    } catch (err) {
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
    typeof clip?.objectPath !== "string" ||
    !clip.objectPath.startsWith("/objects/") ||
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
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) return res.status(400).json({ error: "Combined clips are too large" });
      const path = join(dir, `input-${index}.mp4`);
      const [bytes] = await file.download();
      await fs.writeFile(path, bytes);
      inputs.push(path);
      durations.push(await duration(path));
      audio.push(await hasAudio(path));
    }

    const totalDuration = durations.reduce((sum, seconds, index) => (
      sum + seconds / (validSpeed(clips[index].speed) ? clips[index].speed : 1)
    ), 0);
    const start = Number.isFinite(Number(body.trimStart)) ? Math.max(0, Number(body.trimStart)) : 0;
    const end = Number.isFinite(Number(body.trimEnd)) ? Math.min(totalDuration, Number(body.trimEnd)) : totalDuration;
    if (end <= start || end - start > 60.5) return res.status(400).json({ error: "Invalid trim range" });

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
    return res.json({
      mediaUrl: mediaUrl(req, outputObject),
      mediaPath: outputObject,
      thumbnailUrl: mediaUrl(req, thumbnailObject),
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
    const file = await storage.getObjectEntityFile(`/objects/${suffix}`);
    const allowed = await storage.canAccessObjectEntity({
      objectFile: file, requestedPermission: ObjectPermission.READ,
    });
    if (!allowed) return res.status(404).end();
    const response = await storage.downloadObject(file);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    return res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch {
    return res.status(404).end();
  }
});

export default router;