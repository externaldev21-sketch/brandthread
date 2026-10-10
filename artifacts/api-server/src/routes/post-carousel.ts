/**
 * POST /api/posts/compose-carousel — renders a POST (profile) carousel.
 *
 * Body: { items: [{ kind: 'photo'|'video', objectPath, crop?, adjust?, trimStart?, trimEnd? }] }
 * Every item is cropped to its own rectangle, scaled to the fixed 3:4 canvas
 * (1080×1440), run through the slide's look adjustments (brightness, contrast,
 * saturation, warmth, structure, fade, vignette) and — for videos — trimmed.
 * Photos come back as JPEG, videos as H.264 MP4, each with a poster image for
 * the profile grid. Up to 14 slides, any mix of photos and videos.
 *
 * Sources are the owner's private uploads (photo-slides / chunked video
 * uploads); they are deleted only after every output exists.
 */
import { Router } from "express";
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
import { CAROUSEL_CANVAS, MAX_CAROUSEL_VIDEO_SECONDS, MAX_SLIDES_BY_SURFACE } from "../lib/postLimits";
import { adjustFilters, cropFilter, parseAdjust, parseCrop, type Adjust, type CropRect } from "../lib/carouselAdjust";

const router = Router();
const storage = new ObjectStorageService();
const exec = promisify(execFile);
const OBJECT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._/-]+$/;
const PREVIEW_TTL_SECONDS = 60 * 60;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1536 * 1024 * 1024;
const { w: W, h: H } = CAROUSEL_CANVAS;

interface Item { kind: "photo" | "video"; objectPath: string; crop: CropRect; adjust: Adjust; trimStart: number; trimEnd: number | null }

async function canPost(clerkId: string): Promise<boolean> {
  const [user] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return user?.accountType === "seller" || user?.accountType === "buyer";
}

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { timeout: 15_000 });
  const v = Number.parseFloat(String(stdout).trim());
  if (!Number.isFinite(v) || v <= 0) throw new Error("Invalid video duration");
  return v;
}

function parseItems(raw: unknown): { ok: true; items: Item[] } | { ok: false; error: string } {
  const max = MAX_SLIDES_BY_SURFACE.profile;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return { ok: false, error: `Provide between 1 and ${max} slides` };
  const items: Item[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i] as Record<string, unknown>;
    if (!r || typeof r !== "object") return { ok: false, error: `Slide ${i} is not an object` };
    if (r.kind !== "photo" && r.kind !== "video") return { ok: false, error: `Slide ${i} kind must be photo or video` };
    if (typeof r.objectPath !== "string" || !OBJECT_PATH_RE.test(r.objectPath) || r.objectPath.split("/").includes("..")) {
      return { ok: false, error: `Slide ${i} has an invalid objectPath` };
    }
    const crop = parseCrop(r.crop);
    if (!crop.ok) return { ok: false, error: `Slide ${i}: ${crop.error}` };
    const adjust = parseAdjust(r.adjust);
    if (!adjust.ok) return { ok: false, error: `Slide ${i}: ${adjust.error}` };
    const trimStart = r.trimStart === undefined ? 0 : Number(r.trimStart);
    const trimEnd = r.trimEnd === undefined || r.trimEnd === null ? null : Number(r.trimEnd);
    if (!Number.isFinite(trimStart) || trimStart < 0 || (trimEnd !== null && (!Number.isFinite(trimEnd) || trimEnd <= trimStart))) {
      return { ok: false, error: `Slide ${i} has an invalid trim range` };
    }
    items.push({ kind: r.kind, objectPath: r.objectPath, crop: crop.crop, adjust: adjust.adjust, trimStart, trimEnd });
  }
  return { ok: true, items };
}

router.post("/compose-carousel", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  if (!(await canPost(clerkId))) return res.status(403).json({ error: "Seller or buyer account required" });
  const parsed = parseItems((req.body as { items?: unknown })?.items);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const { items } = parsed;

  const dir = await fs.mkdtemp(join(tmpdir(), "bt-carousel-"));
  const outputs: Array<{ kind: "photo" | "video"; mediaPath: string; thumbnailPath: string; duration?: number }> = [];
  const created: string[] = [];
  try {
    let totalBytes = 0;
    let totalVideoSeconds = 0;
    const inputs: string[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const file = await storage.getObjectEntityFile(item.objectPath);
      const allowed = await storage.canAccessObjectEntity({ userId: clerkId, objectFile: file, requestedPermission: ObjectPermission.WRITE });
      if (!allowed) return res.status(403).json({ error: `Slide ${i} is not owned by this account` });
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      const limit = item.kind === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
      if (!Number.isFinite(size) || size <= 0 || size > limit) return res.status(400).json({ error: `Slide ${i} is empty or too large` });
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) return res.status(400).json({ error: "Combined slides exceed the total size limit" });
      const input = join(dir, `in_${i}`);
      await file.download({ destination: input });
      const fh = await fs.open(input, "r");
      const head = Buffer.alloc(16);
      try { await fh.read(head, 0, 16, 0); } finally { await fh.close(); }
      const isJpeg = head[0] === 0xff && head[1] === 0xd8;
      const isPng = head[0] === 0x89 && head[1] === 0x50;
      const isWebp = head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
      const isIso = head.subarray(4, 8).toString("ascii") === "ftyp";
      const isWebm = head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      if (item.kind === "photo" ? !(isJpeg || isPng || isWebp) : !(isIso || isWebm)) {
        return res.status(400).json({ error: `Slide ${i} is not a valid ${item.kind}` });
      }
      if (item.kind === "video") {
        const d = await probeDuration(input);
        const end = Math.min(item.trimEnd ?? d, d);
        if (end <= item.trimStart) return res.status(400).json({ error: `Slide ${i} has an invalid trim range` });
        totalVideoSeconds += end - item.trimStart;
        if (totalVideoSeconds > MAX_CAROUSEL_VIDEO_SECONDS + 0.01) return res.status(400).json({ error: "Videos in one post can total up to 10 minutes" });
        item.trimEnd = end;
      }
      inputs.push(input);
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const look = adjustFilters(item.adjust);
      const base = [cropFilter(item.crop), `scale=${W}:${H}:flags=lanczos`, ...look, "setsar=1"];
      const poster = join(dir, `poster_${i}.jpg`);
      let outPath: string;
      let contentType: string;
      if (item.kind === "photo") {
        outPath = join(dir, `out_${i}.jpg`);
        contentType = "image/jpeg";
        await exec("ffmpeg", ["-y", "-i", inputs[i], "-vf", base.join(","), "-frames:v", "1", "-q:v", "2", outPath], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
        await fs.copyFile(outPath, poster);
      } else {
        outPath = join(dir, `out_${i}.mp4`);
        contentType = "video/mp4";
        const len = (item.trimEnd ?? 0) - item.trimStart;
        await exec("ffmpeg", [
          "-y", "-ss", String(item.trimStart), "-t", String(len), "-i", inputs[i],
          "-vf", [...base, "fps=30", "format=yuv420p"].join(","),
          "-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-crf", "21", "-maxrate", "8M", "-bufsize", "16M",
          "-c:a", "aac", "-ar", "44100", "-movflags", "+faststart", outPath,
        ], { timeout: 20 * 60_000, maxBuffer: 8 * 1024 * 1024 });
        await exec("ffmpeg", ["-y", "-ss", String(Math.min(0.5, len / 3)), "-i", outPath, "-frames:v", "1", "-q:v", "3", poster], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      }
      const mediaPath = await storage.createObjectEntityFromBuffer(await fs.readFile(outPath), contentType);
      created.push(mediaPath);
      await storage.trySetObjectEntityAclPolicy(mediaPath, { owner: clerkId, visibility: "private" });
      const thumbnailPath = await storage.createObjectEntityFromBuffer(await fs.readFile(poster), "image/jpeg");
      created.push(thumbnailPath);
      await storage.trySetObjectEntityAclPolicy(thumbnailPath, { owner: clerkId, visibility: "private" });
      outputs.push({ kind: item.kind, mediaPath, thumbnailPath, duration: item.kind === "video" ? (item.trimEnd ?? 0) - item.trimStart : undefined });
    }

    const result = await Promise.all(outputs.map(async (o) => ({
      ...o,
      mediaUrl: await storage.getObjectEntityDownloadURL(o.mediaPath, PREVIEW_TTL_SECONDS),
      thumbnailUrl: await storage.getObjectEntityDownloadURL(o.thumbnailPath, PREVIEW_TTL_SECONDS),
    })));
    await Promise.all([...new Set(items.map((i) => i.objectPath))].map((p) => storage.deleteObjectEntity(p).catch((err) => {
      req.log.warn({ err, clerkId, objectPath: p }, "Could not clean up carousel source");
    })));
    return res.json({ items: result });
  } catch (err) {
    await Promise.all(created.map((p) => storage.deleteObjectEntity(p).catch(() => {})));
    req.log.error({ err, clerkId }, "Could not compose carousel");
    return res.status(500).json({ error: "Post could not be composed" });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
