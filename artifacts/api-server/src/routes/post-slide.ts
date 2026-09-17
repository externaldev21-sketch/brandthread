/**
 * POST /api/posts/photo-slides  — upload a single raw photo slide (private, owner-only)
 * POST /api/posts/compose-slideshow — render slides with text overlays using FFmpeg drawtext,
 *   return ordered durable rendered paths + preview URLs + thumbnail.
 *
 * Security:
 *  - MIME validation via magic bytes (JPEG/PNG/WEBP only)
 *  - Max slide count, max bytes per slide, max total bytes
 *  - Text overlays validated identically to compose-video (shared validateOverlays)
 *  - No shell interpolation: overlay text written to temp textfiles
 *  - Object path ownership check before reading slide objects
 *  - Temp files and source upload objects cleaned only after successful output
 */
import express, { Router } from "express";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { db, posts, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import {
  validateOverlaysArray, MAX_SLIDES,
  type ValidatedOverlay,
} from "../lib/slideValidation";

const router = Router();
const storage = new ObjectStorageService();
const exec = promisify(execFile);

// ─── Constants ────────────────────────────────────────────────────────────────
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SLIDE_BYTES = 20 * 1024 * 1024;  // 20 MB per slide
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;  // 80 MB total
const SLIDE_PREVIEW_TTL_SECONDS = 60 * 60; // 1 hour signed URL

// Output portrait canvas for slides (matching video compose)
const SLIDE_W = 720;
const SLIDE_H = 1280;

const OBJECT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._/-]+$/;

const FALLBACK_FONT      = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FALLBACK_FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlideInput {
  objectPath: string;
  overlays?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function isSeller(clerkId: string): Promise<boolean> {
  const [user] = await db.select({ accountType: users.accountType })
    .from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return user?.accountType === "seller";
}

function validObjectPath(value: unknown): value is string {
  return typeof value === "string" &&
    OBJECT_PATH_RE.test(value) &&
    !value.split("/").includes("..");
}

/** Read JPEG/PNG/WEBP magic bytes to confirm image type */
function isSupportedImage(contentType: string, bytes: Buffer): boolean {
  if (!IMAGE_TYPES.has(contentType)) return false;
  if (bytes.length < 4) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png  = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return jpeg || png || webp;
}

async function discoverFont(style: string): Promise<string> {
  const wantBold = ["retro","postcard","technic","classic"].includes(style);
  const preferred = wantBold ? FALLBACK_FONT_BOLD : FALLBACK_FONT;
  try {
    const { stdout } = await exec("fc-match", ["--format=%{file}", "sans-serif"], {
      timeout: 5_000, maxBuffer: 1024 * 256,
    });
    const found = String(stdout).trim();
    if (found && found.endsWith(".ttf")) return found;
  } catch { /* fall through */ }
  try { await fs.access(preferred); return preferred; } catch { /* fall through */ }
  await fs.access(FALLBACK_FONT);
  return FALLBACK_FONT;
}

async function writeTextFile(dir: string, id: string, text: string): Promise<string> {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
  const textPath = join(dir, `overlay_${safe}.txt`);
  await fs.writeFile(textPath, text, "utf8");
  return textPath;
}

/**
 * Build the FFmpeg drawtext filter string for a single overlay on a still image.
 * Uses textfile= so no user text is ever interpolated into shell/FFmpeg arguments.
 */
function buildImageDrawtext(
  overlay: ValidatedOverlay,
  textFile: string,
  fontPath: string,
): string {
  const hexRaw   = overlay.color.replace("#", "");
  const ffColor  = `0x${hexRaw}`;
  const bgAlpha  = overlay.bgStyle === "solid" ? 1.0 : overlay.bgStyle === "semi" ? 0.55 : 0;
  const boxColor = bgAlpha > 0 ? `black@${bgAlpha}` : "black@0";
  const boxEnabled = bgAlpha > 0 ? 1 : 0;

  let xExpr: string;
  if (overlay.align === "center") xExpr = `${Math.round(overlay.x * SLIDE_W)}-text_w/2`;
  else if (overlay.align === "right") xExpr = `${Math.round(overlay.x * SLIDE_W)}-text_w`;
  else xExpr = String(Math.round(overlay.x * SLIDE_W));
  const yExpr = `${Math.round(overlay.y * SLIDE_H)}-text_h/2`;

  const safeFont     = fontPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const safeTextFile = textFile.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

  return [
    `textfile='${safeTextFile}'`,
    `fontfile='${safeFont}'`,
    `fontsize=${Math.round(overlay.fontSize)}`,
    `fontcolor=${ffColor}`,
    `box=${boxEnabled}`,
    `boxcolor=${boxColor}`,
    `boxborderw=8`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `line_spacing=2`,
  ].join(":");
}

// ─── POST /api/posts/photo-slides ─────────────────────────────────────────────
// Upload a single raw photo slide. Returns { objectPath, contentType, size }.
router.post(
  "/photo-slides",
  requireAuth,
  express.raw({ type: [...IMAGE_TYPES], limit: MAX_SLIDE_BYTES }),
  async (req, res) => {
    const clerkId = (req as any).clerkUserId as string;
    if (!(await isSeller(clerkId))) {
      return res.status(403).json({ error: "Seller account required" });
    }
    const contentType = String(req.get("content-type") ?? "").split(";")[0].toLowerCase();
    if (!IMAGE_TYPES.has(contentType)) {
      return res.status(415).json({ error: "Unsupported image type (JPEG, PNG, or WEBP only)" });
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) return res.status(400).json({ error: "Empty image body" });
    if (bytes.length > MAX_SLIDE_BYTES) {
      return res.status(400).json({ error: `Image exceeds ${MAX_SLIDE_BYTES / 1024 / 1024} MB limit` });
    }
    if (!isSupportedImage(contentType, bytes)) {
      return res.status(400).json({ error: "Invalid image file (magic bytes mismatch)" });
    }

    let objectPath: string | null = null;
    try {
      objectPath = await storage.createObjectEntityFromBuffer(bytes, contentType);
      await storage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkId, visibility: "private" });
      return res.status(201).json({ objectPath, contentType, size: bytes.length });
    } catch (err) {
      if (objectPath) await storage.deleteObjectEntity(objectPath).catch(() => {});
      req.log.error({ err, clerkId }, "Could not upload photo slide");
      return res.status(500).json({ error: "Photo slide could not be uploaded" });
    }
  },
);

// ─── POST /api/posts/compose-slideshow ────────────────────────────────────────
// Accepts ordered slide object paths with per-slide text overlays.
// Uses FFmpeg to render each still with overlays → portrait JPEG → upload.
// Returns ordered rendered paths + preview URLs + thumbnail.
router.post("/compose-slideshow", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  if (!(await isSeller(clerkId))) {
    return res.status(403).json({ error: "Seller account required" });
  }

  const body = req.body as { slides?: unknown };
  const rawSlides = body.slides;

  if (!Array.isArray(rawSlides) || rawSlides.length === 0 || rawSlides.length > MAX_SLIDES) {
    return res.status(400).json({ error: `Provide between 1 and ${MAX_SLIDES} slides` });
  }

  // Validate each slide entry
  const slideInputs: Array<{ objectPath: string; overlays: ValidatedOverlay[] }> = [];
  for (let si = 0; si < rawSlides.length; si++) {
    const slide = rawSlides[si] as SlideInput;
    if (!slide || typeof slide !== "object") {
      return res.status(400).json({ error: `Slide ${si} is not an object` });
    }
    if (!validObjectPath(slide.objectPath)) {
      return res.status(400).json({ error: `Slide ${si} has an invalid objectPath` });
    }
    const ovResult = validateOverlaysArray(slide.overlays, `slide[${si}]`);
    if (!ovResult.ok) {
      return res.status(400).json({ error: ovResult.error });
    }
    slideInputs.push({ objectPath: slide.objectPath, overlays: ovResult.overlays });
  }

  const dir = await fs.mkdtemp(join(tmpdir(), "bt-slideshow-"));
  const outputObjects: string[] = [];
  let thumbnailObject: string | null = null;
  const textFiles: string[] = [];

  try {
    // Phase 1: validate ownership + download all slides
    let totalBytes = 0;
    const inputPaths: string[] = [];
    for (let si = 0; si < slideInputs.length; si++) {
      const { objectPath } = slideInputs[si];
      const file = await storage.getObjectEntityFile(objectPath);
      const allowed = await storage.canAccessObjectEntity({
        userId: clerkId, objectFile: file, requestedPermission: ObjectPermission.WRITE,
      });
      if (!allowed) {
        return res.status(403).json({ error: `Slide ${si} is not owned by this seller` });
      }
      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (!Number.isFinite(size) || size <= 0 || size > MAX_SLIDE_BYTES) {
        return res.status(400).json({ error: `Slide ${si} is empty or too large` });
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return res.status(400).json({ error: "Combined slides exceed total size limit" });
      }
      const contentType = String(metadata.contentType ?? "").split(";")[0].toLowerCase();
      const [bytes] = await file.download();
      if (!isSupportedImage(contentType, Buffer.from(bytes))) {
        return res.status(400).json({ error: `Slide ${si} is not a valid image` });
      }
      const inputPath = join(dir, `slide_${si}.jpg`);
      await fs.writeFile(inputPath, bytes);
      inputPaths.push(inputPath);
    }

    // Discover fonts once for all overlays
    const regularFont = await discoverFont("regular");
    const boldFont    = await discoverFont("bold");

    // Phase 2: render each slide with FFmpeg
    for (let si = 0; si < slideInputs.length; si++) {
      const { overlays } = slideInputs[si];
      const inputPath  = inputPaths[si];
      const outputPath = join(dir, `rendered_${si}.jpg`);

      if (overlays.length === 0) {
        // No overlays — just resize/pad to portrait canvas
        await exec("ffmpeg", [
          "-y", "-i", inputPath,
          "-vf", `scale=${SLIDE_W}:${SLIDE_H}:force_original_aspect_ratio=decrease,pad=${SLIDE_W}:${SLIDE_H}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
          "-frames:v", "1", "-q:v", "3", outputPath,
        ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      } else {
        // Build chained drawtext filter
        const drawtextParts: string[] = [];
        for (let oi = 0; oi < overlays.length; oi++) {
          const ov = overlays[oi];
          const bold = ["retro","postcard","technic","classic"].includes(ov.fontStyle);
          const fontPath = bold ? boldFont : regularFont;
          const textFile = await writeTextFile(dir, `${si}_${ov.id}`, ov.text);
          textFiles.push(textFile);
          drawtextParts.push(`drawtext=${buildImageDrawtext(ov, textFile, fontPath)}`);
        }
        const overlayFilter = drawtextParts.join(",");
        const baseFilter = `scale=${SLIDE_W}:${SLIDE_H}:force_original_aspect_ratio=decrease,pad=${SLIDE_W}:${SLIDE_H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

        await exec("ffmpeg", [
          "-y", "-i", inputPath,
          "-vf", `${baseFilter},${overlayFilter}`,
          "-frames:v", "1", "-q:v", "3", outputPath,
        ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
      }

      // Upload rendered slide
      const renderedBytes = await fs.readFile(outputPath);
      const objectPath = await storage.createObjectEntityFromBuffer(renderedBytes, "image/jpeg");
      await storage.trySetObjectEntityAclPolicy(objectPath, { owner: clerkId, visibility: "private" });
      outputObjects.push(objectPath);
    }

    // Phase 3: thumbnail = first rendered slide (already portrait JPEG)
    const thumbSrcPath = join(dir, "rendered_0.jpg");
    const thumbPath    = join(dir, "thumbnail.jpg");
    await exec("ffmpeg", [
      "-y", "-i", thumbSrcPath,
      "-vf", `scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2`,
      "-frames:v", "1", "-q:v", "4", thumbPath,
    ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    const thumbBytes = await fs.readFile(thumbPath);
    thumbnailObject = await storage.createObjectEntityFromBuffer(thumbBytes, "image/jpeg");
    await storage.trySetObjectEntityAclPolicy(thumbnailObject, { owner: clerkId, visibility: "private" });

    // Phase 4: generate signed preview URLs
    const previewUrls = await Promise.all(
      outputObjects.map((p) => storage.getObjectEntityDownloadURL(p, SLIDE_PREVIEW_TTL_SECONDS)),
    );
    const thumbnailUrl = await storage.getObjectEntityDownloadURL(thumbnailObject, SLIDE_PREVIEW_TTL_SECONDS);

    // Phase 5: clean up source upload objects (only after all outputs are ready)
    const sourceObjectPaths = [...new Set(slideInputs.map((s) => s.objectPath))];
    await Promise.all(
      sourceObjectPaths.map((p) =>
        storage.deleteObjectEntity(p).catch((err) => {
          req.log.warn({ err, clerkId, objectPath: p }, "Could not clean up source slide");
        }),
      ),
    );

    return res.json({
      mediaPaths: outputObjects,
      mediaUrls:  previewUrls,
      thumbnailPath: thumbnailObject,
      thumbnailUrl,
      slideCount: outputObjects.length,
    });
  } catch (err) {
    // Clean up any output objects created before the failure
    await Promise.all(
      outputObjects.map((p) => storage.deleteObjectEntity(p).catch(() => {})),
    );
    if (thumbnailObject) await storage.deleteObjectEntity(thumbnailObject).catch(() => {});
    req.log.error({ err, clerkId }, "Could not compose slideshow");
    return res.status(500).json({ error: "Slideshow could not be composed" });
  } finally {
    // Always clean up temp text files and working directory
    for (const tf of textFiles) await fs.unlink(tf).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
