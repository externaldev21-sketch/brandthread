/**
 * Video remixes (lib/remix.ts holds the rules).
 *
 * GET  /api/remix/posts/:postId       — may I remix this video?
 *                                       { allowed, code?, message?, canPostVideo, source? }
 * POST /api/remix/posts/:postId/clip  — copy the source video into a private
 *                                       clip I own, so the create flow can
 *                                       compose it: { objectPath, duration, previewUrl, source }
 *
 * Publishing goes through POST /api/posts with `remixOfPostId`, which runs the
 * same check and answers 403 REMIX_NOT_ALLOWED when the author doesn't allow it.
 */
import { Router } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { checkRemix } from "../lib/remix";

const router = Router();
const storage = new ObjectStorageService();
const exec = promisify(execFile);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_CLIP_BYTES = 80 * 1024 * 1024;

router.use(requireAuth);

/** Video posting (and so remixing) is a seller capability (routes/post-video.ts). */
async function canPostVideo(userId: string): Promise<boolean> {
  const [user] = await db.select({ accountType: users.accountType }).from(users)
    .where(eq(users.clerkId, userId)).limit(1);
  return user?.accountType === "seller";
}

async function videoDuration(bytes: Buffer): Promise<number> {
  const dir = await fs.mkdtemp(join(tmpdir(), "brandthread-remix-"));
  try {
    const path = join(dir, "source.mp4");
    await fs.writeFile(path, bytes);
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path,
    ], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    const seconds = Number(String(stdout).trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

router.get("/posts/:postId", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    const [check, video] = await Promise.all([
      checkRemix(String(req.params.postId), userId),
      canPostVideo(userId),
    ]);
    if (!check.allowed) {
      if (check.code === "POST_NOT_FOUND") return res.status(404).json({ error: check.message, code: check.code });
      return res.json({ allowed: false, code: check.code, message: check.message, canPostVideo: video });
    }
    return res.json({
      allowed: true,
      canPostVideo: video,
      source: { postId: check.source.id, authorId: check.source.authorId, authorUsername: check.source.authorUsername },
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to check remix permission");
    return res.status(500).json({ error: "Could not check this video. Try again." });
  }
});

router.post("/posts/:postId/clip", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  if (!(await canPostVideo(userId))) {
    return res.status(403).json({ error: "Seller account required", code: "SELLER_REQUIRED" });
  }
  const check = await checkRemix(String(req.params.postId), userId);
  if (!check.allowed) return res.status(check.status).json({ error: check.message, code: check.code });
  let objectPath: string | null = null;
  try {
    const file = await storage.getObjectEntityFile(check.source.objectPath);
    const [metadata] = await file.getMetadata();
    const contentType = String(metadata.contentType ?? "video/mp4").split(";")[0].toLowerCase();
    const size = Number(metadata.size ?? 0);
    if (!VIDEO_TYPES.has(contentType) || !Number.isFinite(size) || size <= 0 || size > MAX_CLIP_BYTES) {
      return res.status(409).json({ error: "This video can't be remixed.", code: "SOURCE_UNAVAILABLE" });
    }
    const [bytes] = await file.download();
    objectPath = await storage.createObjectEntityFromBuffer(bytes, contentType);
    await storage.trySetObjectEntityAclPolicy(objectPath, { owner: userId, visibility: "private" });
    const duration = await videoDuration(bytes).catch(() => 0);
    return res.status(201).json({
      objectPath,
      duration,
      previewUrl: check.source.mediaUrl,
      source: { postId: check.source.id, authorId: check.source.authorId, authorUsername: check.source.authorUsername },
    });
  } catch (err) {
    if (objectPath) await storage.deleteObjectEntity(objectPath).catch(() => {});
    req.log?.error({ err, postId: check.source.id }, "Could not prepare remix clip");
    return res.status(500).json({ error: "Couldn't load this video. Try again." });
  }
});

export default router;
