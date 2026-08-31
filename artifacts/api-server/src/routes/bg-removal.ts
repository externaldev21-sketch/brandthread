import { Router } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import {
  buildFashionPrompt,
  editImages,
  generateWithVisualQa,
  ImageQualityError,
  ImageQualityUnavailableError,
} from "@workspace/integrations-openai-ai-server/image";
import { objectStorageClient } from "../lib/objectStorage";

const router = Router();
router.use(requireAuth);

// ─── Config ─────────────────────────────────────────────────────────────────

const BUCKET_ID = (process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "").trim();
const PRIVATE_DIR = (process.env.PRIVATE_OBJECT_DIR ?? "").trim(); // e.g. /bucket/.private
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const ACCEPTED_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/]+=*)$/;

interface DecodedImage {
  buffer: Buffer;
  mime: string;
}

function decodeDataUrl(input: string): DecodedImage | null {
  const match = DATA_URL_RE.exec(input);
  if (!match) return null;
  const [, mime, base64] = match;
  if (!ACCEPTED_MIMES.has(mime)) return null;
  if (!BASE64_RE.test(base64)) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    return buffer.length > 0 ? { buffer, mime } : null;
  } catch {
    return null;
  }
}

// ─── Object Storage helpers ──────────────────────────────────────────────────

function parseBucketAndPrefix(): { bucket: string; prefix: string } | null {
  if (!BUCKET_ID || !PRIVATE_DIR) return null;
  // PRIVATE_DIR = "/bucket-id/.private" — strip leading slash then split
  const stripped = PRIVATE_DIR.replace(/^\//, "");
  const slashIdx = stripped.indexOf("/");
  if (slashIdx === -1) return { bucket: stripped, prefix: "" };
  return {
    bucket: stripped.slice(0, slashIdx),
    prefix: stripped.slice(slashIdx + 1),
  };
}

/** Save a PNG buffer to GCS. Returns storageKey (objectName) or null on failure. */
async function saveToGCS(buffer: Buffer, userId: string, uuid: string): Promise<string | null> {
  const parts = parseBucketAndPrefix();
  if (!parts) return null;
  const objectName = parts.prefix
    ? `${parts.prefix}/bg-removal/${userId}/${uuid}.png`
    : `bg-removal/${userId}/${uuid}.png`;
  try {
    await objectStorageClient.bucket(parts.bucket).file(objectName).save(buffer, {
      contentType: "image/png",
      resumable: false,
      metadata: {
        userId,
        createdAt: new Date().toISOString(),
      },
    });
    return objectName; // storageKey
  } catch {
    return null; // non-fatal: main flow still returns b64_json
  }
}

/** Stream a file from GCS to the response. Validates userId ownership. */
async function serveFromGCS(
  res: any,
  storageKey: string,
  requestingUserId: string,
): Promise<void> {
  // Ownership check: storageKey must contain the requesting userId in its path
  const ownedPrefix = `bg-removal/${requestingUserId}/`;
  const check = storageKey.includes(ownedPrefix);
  if (!check) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const parts = parseBucketAndPrefix();
  if (!parts) {
    res.status(503).json({ error: "Storage not configured." });
    return;
  }
  try {
    const file = objectStorageClient.bucket(parts.bucket).file(storageKey);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Result not found." });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400");
    file.createReadStream().pipe(res);
  } catch {
    res.status(502).json({ error: "Could not retrieve result. Please try again." });
  }
}

// ─── POST /api/bg-removal/remove ────────────────────────────────────────────

router.post("/remove", async (req, res) => {
  const userId: string = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "";

  const { image } = req.body ?? {};
  if (typeof image !== "string") {
    res.status(400).json({ error: "An image is required." });
    return;
  }

  const decoded = decodeDataUrl(image);
  if (!decoded) {
    res.status(400).json({
      error: "Invalid image. Accepted formats: PNG, JPG, JPEG, or WebP. Please re-upload.",
    });
    return;
  }
  if (decoded.buffer.length > MAX_IMAGE_BYTES) {
    res.status(400).json({ error: "Image is too large. Maximum size is 8 MB. Please resize and try again." });
    return;
  }

  const uuid = randomUUID();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-replace-"));
  const tmpFile = path.join(tmpDir, `${uuid}.png`);

  try {
    await fs.writeFile(tmpFile, decoded.buffer);

    const prompt = buildFashionPrompt(
      "background_remove",
      "Remove the background completely and output a transparent PNG.",
      "Keep only the main subject/product in the same position and framing with clean, precise edges. Add no background, shadow, texture, or new detail.",
    );
    const resultBuffer = await generateWithVisualQa({
      operation: "background_replace",
      prompt: editPrompt,
      brief: direction,
      references,
      generate: (retryPrompt) => editImages(files, retryPrompt),
    });

    const resultSize = resultBuffer.length;
    const b64Json = resultBuffer.toString("base64");
    const createdAt = new Date().toISOString();

    // Save to GCS (non-blocking — failure is non-fatal)
  const storageKey = (req.params as any).storageKey as string | undefined;

    res.json({
      b64_json: b64Json,
      storageKey: storageKey ?? null,
      size: resultSize,
      mime: "image/png",
      createdAt,
      id: uuid,
    });
  } catch (err: any) {
    // Check for provider-specific rejection
    const msg = err?.message ?? "";
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "The cutout did not preserve the subject accurately enough. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Background-removal verification is temporarily unavailable. Please try again.", retryable: true });
    } else if (msg.includes("Could not process image") || msg.includes("invalid")) {
      res.status(422).json({ error: "The provider could not process this image. Please try a different photo." });
    } else {
      res.status(502).json({ error: "Background removal failed. Please try again." });
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// ─── POST /api/bg-removal/replace ───────────────────────────────────────────
// { image, backgroundImage?, prompt?, color?, bgType? }
// Image 1 is always the locked source subject. Image 2, when supplied, is the
// replacement background reference.
router.post("/replace", async (req, res) => {
  const userId: string = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "";

  const { image, backgroundImage, prompt, color, bgType } = req.body ?? {};
  const source = decodeDataUrl(image);
  const background = backgroundImage === undefined ? null : decodeDataUrl(backgroundImage);
  if (!source) {
    res.status(400).json({ error: "A valid source image is required." });
    return;
  }
  if (backgroundImage !== undefined && !background) {
    res.status(400).json({ error: "The replacement background image is invalid." });
    return;
  }
  if (source.buffer.length > MAX_IMAGE_BYTES || (background && background.buffer.length > MAX_IMAGE_BYTES)) {
    res.status(400).json({ error: "Each image must be under 8 MB." });
    return;
  }

  const safePrompt = typeof prompt === "string" ? prompt.trim().slice(0, 400) : "";
  const safeColor = typeof color === "string" ? color.trim().slice(0, 32) : "";
  const safeBgType = typeof bgType === "string" ? bgType.trim().slice(0, 32) : "";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-replace-"));

  try {
    const sourcePath = path.join(tmpDir, `${randomUUID()}-source.png`);
    await fs.writeFile(sourcePath, source.buffer);
    const files = [sourcePath];
    if (background) {
      const backgroundPath = path.join(tmpDir, `${randomUUID()}-background.png`);
      await fs.writeFile(backgroundPath, background.buffer);
      files.push(backgroundPath);
    }

    const direction = background
      ? "Use Image 2 as the new background."
      : safePrompt || (safeColor ? `Use a solid ${safeColor} background.` : `Create the requested ${safeBgType || "studio"} background.`);
    const editPrompt = buildFashionPrompt(
      "background_replace",
      direction,
      "Image 1 is the locked foreground subject. Image 2, when present, is the authoritative replacement background. Blend edges, lighting, and shadows naturally without redesigning the foreground.",
    );
    const references = background ? [source.buffer, background.buffer] : [source.buffer];
    const resultBuffer = await generateWithVisualQa({
      operation: "background_replace",
      prompt: editPrompt,
      brief: direction,
      references,
      generate: (retryPrompt) => editImages(files, retryPrompt),
    });
    res.json({ b64_json: resultBuffer.toString("base64") });
  } catch (err) {
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "The new background did not preserve the subject accurately enough. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Background-replacement verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "Background replacement failed. Please try again." });
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// ─── GET /api/bg-removal/results/:key(*) ────────────────────────────────────
// Serves a previously processed result from GCS.
// The storageKey is URL-encoded in the path.

router.get("/results/*storageKey", async (req, res) => {
  const userId: string = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "";
  if (!userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const storageKey = (req.params as any).storageKey as string | undefined;
  if (!storageKey) {
    res.status(400).json({ error: "No storage key provided." });
    return;
  }

  await serveFromGCS(res, decodeURIComponent(storageKey), userId);
});

export default router;
