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
  type ImageOperation,
} from "@workspace/integrations-openai-ai-server/image";

const router = Router();
router.use(requireAuth);

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per photo
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB across all photos

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function decodeDataUrl(input: string): Buffer | null {
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(input);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2];
  if (!ALLOWED_IMAGE_MIMES.has(mime)) return null;
  if (!base64 || !BASE64_RE.test(base64)) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) return null;
    const hasValidSignature =
      (mime === "image/png" &&
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (mime === "image/jpeg" &&
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff) ||
      (mime === "image/webp" &&
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP");
    return hasValidSignature ? buffer : null;
  } catch {
    return null;
  }
}

// POST /api/photography/generate  { images: string[] (base64/data-url), prompt?: string }
router.post("/generate", async (req, res) => {
  const { images, prompt } = req.body ?? {};
  if (!Array.isArray(images) || images.length === 0) {
    res.status(400).json({ error: "At least one reference or product photo is required." });
    return;
  }
  if (images.length > MAX_IMAGES) {
    res.status(400).json({ error: `Please upload at most ${MAX_IMAGES} photos.` });
    return;
  }

  const safeDescription =
    typeof prompt === "string" && prompt.trim().length > 0
      ? prompt.trim().slice(0, 500)
      : "";

  // Decode and validate all photos up front (size + format) before touching disk.
  const decoded: Buffer[] = [];
  let totalBytes = 0;
  for (const img of images) {
    if (typeof img !== "string") {
      res.status(400).json({ error: "Each photo must be a base64-encoded image." });
      return;
    }
    const buffer = decodeDataUrl(img);
    if (!buffer) {
      res.status(400).json({ error: "One or more photos are not valid images. Please re-upload." });
      return;
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: "Each photo must be under 8MB." });
      return;
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      res.status(400).json({ error: "Total photo size is too large. Please upload smaller or fewer photos." });
      return;
    }
    decoded.push(buffer);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "product-photo-"));
  const tmpFiles: string[] = [];

  try {
    for (const buffer of decoded) {
      const filePath = path.join(tmpDir, `${randomUUID()}.png`);
      await fs.writeFile(filePath, buffer);
      tmpFiles.push(filePath);
    }

    const operation: ImageOperation = mode === "mockup_to_model" ? "mockup_to_model" : "photoshoot";
    const editPrompt = buildFashionPrompt(
      operation,
      safeDescription,
      "Use the uploaded product/reference photos as authoritative visual references. Create one finished image with a realistic human model and preserve the product exactly.",
    );
    const buffer = await generateWithVisualQa({
      operation,
      prompt: editPrompt,
      brief: safeDescription,
      references: decoded,
      generate: (retryPrompt) => editImages(tmpFiles, retryPrompt),
    });
    res.json({ b64_json: buffer.toString("base64") });
  } catch (err) {
    // Do not leak upstream provider error details to the client.
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "The generated photo did not meet the quality check. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Photo quality verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "Photo generation failed. Please try again." });
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/photography/outfit-swap
// { heroImage: string (base64/data-url), garmentImages: string[], prompt?: string }
// The hero is deliberately kept as the first image for every edit call. This
// is what makes the model, pose, framing, and background consistent across a
// batch instead of treating each garment as a new free-form generation.
router.post("/outfit-swap", async (req, res) => {
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  const { heroImage, garmentImages, prompt } = req.body ?? {};
  if (typeof heroImage !== "string") {
    res.status(400).json({ error: "One hero photo is required for Outfit Swap." });
    return;
  }
  if (!Array.isArray(garmentImages) || garmentImages.length === 0) {
    res.status(400).json({ error: "At least one garment design is required for Outfit Swap." });
    return;
  }
  if (garmentImages.length > MAX_IMAGES) {
    res.status(400).json({ error: `Please upload at most ${MAX_IMAGES} garment designs.` });
    return;
  }
  const safeDescription =
    typeof prompt === "string" && prompt.trim().length > 0
      ? prompt.trim().slice(0, 500)
      : "";

  const decoded: Buffer[] = [];
  let totalBytes = 0;
  for (const image of [heroImage, ...garmentImages]) {
    if (typeof image !== "string") {
      res.status(400).json({ error: "Each Outfit Swap image must be a base64-encoded image." });
      return;
    }
    const buffer = decodeDataUrl(image);
    if (!buffer) {
      res.status(400).json({ error: "One or more Outfit Swap images are not valid. Please re-upload." });
      return;
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: "Each photo must be under 8MB." });
      return;
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      res.status(400).json({ error: "Total photo size is too large. Please upload smaller or fewer images." });
      return;
    }
    decoded.push(buffer);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "outfit-swap-"));
  const tmpFiles: string[] = [];
  const results: { garmentIndex: number; b64_json: string }[] = [];
  const errors: { garmentIndex: number }[] = [];
  const qualityErrors: { garmentIndex: number; reasons: string[] }[] = [];
  let providerFailureCount = 0;

  try {
    const heroFile = path.join(tmpDir, `${randomUUID()}-hero.png`);
    await fs.writeFile(heroFile, decoded[0]);
    tmpFiles.push(heroFile);

    for (let i = 0; i < garmentImages.length; i += 1) {
      const garmentFile = path.join(tmpDir, `${randomUUID()}-garment-${i + 1}.png`);
      await fs.writeFile(garmentFile, decoded[i + 1]);
      tmpFiles.push(garmentFile);

      const editPrompt = buildFashionPrompt(
        "outfit_swap",
        safeDescription,
        "Image 1 is the locked base hero photo. Image 2 is the selected garment design. Replace only the clothing on the existing model.",
      );

      try {
        const buffer = await generateWithVisualQa({
          operation: "outfit_swap",
          prompt: editPrompt,
          brief: safeDescription,
          references: [decoded[0], decoded[i + 1]],
          generate: (retryPrompt) => editImages([heroFile, garmentFile], retryPrompt),
        });
        results.push({ garmentIndex: i + 1, b64_json: buffer.toString("base64") });
      } catch (err) {
        // Keep successful garment results when one provider call fails.
        errors.push({ garmentIndex: i + 1 });
        if (err instanceof ImageQualityError) {
          qualityErrors.push({ garmentIndex: i + 1, reasons: err.reasons });
        } else {
          providerFailureCount += 1;
        }
      }
    }

    if (results.length === 0 && errors.length > 0 && providerFailureCount === 0) {
      // Never silently return an entirely unverified batch. The client can
      // still use the per-garment metadata for a targeted retry.
      res.status(422).json({
        error: "No Outfit Swap result passed the quality check. Please retry the failed garments.",
        retryable: true,
        results,
        errors,
        ...(qualityErrors.length > 0 ? { qualityErrors } : {}),
      });
      return;
    }
    if (results.length === 0) {
      res.status(502).json({
        error: "Outfit Swap generation failed. Please try again.",
        retryable: true,
        errors,
        ...(qualityErrors.length > 0 ? { qualityErrors } : {}),
      });
      return;
    }
    res.json({
      results,
      ...(errors.length > 0 ? { errors } : {}),
      ...(qualityErrors.length > 0 ? { qualityErrors } : {}),
    });
  } catch (_err) {
    // Do not leak upstream provider error details to the client.
    res.status(502).json({ error: "Outfit Swap generation failed. Please try again." });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/photography/outfit-swap/retry
// { heroImage: string, garmentImage: string, garmentIndex: number, prompt?: string }
// Retry only the failed garment so successful edits do not run again.
router.post("/outfit-swap/retry", async (req, res) => {
  const { heroImage, garmentImage, garmentIndex, prompt } = req.body ?? {};

  if (typeof heroImage !== "string" || typeof garmentImage !== "string") {
    res.status(400).json({ error: "A hero photo and garment design are required for this retry." });
    return;
  }
  if (!Number.isInteger(garmentIndex) || garmentIndex < 1 || garmentIndex > MAX_IMAGES) {
    res.status(400).json({ error: "The garment being retried is not valid." });
    return;
  }
  const safeDescription =
    typeof prompt === "string" && prompt.trim().length > 0
      ? prompt.trim().slice(0, 500)
      : "";
  const heroBuffer = decodeDataUrl(heroImage);
  const garmentBuffer = decodeDataUrl(garmentImage);
  if (!heroBuffer || !garmentBuffer) {
    res.status(400).json({ error: "One or more Outfit Swap images are not valid. Please re-upload." });
    return;
  }
  if (heroBuffer.length > MAX_IMAGE_BYTES || garmentBuffer.length > MAX_IMAGE_BYTES) {
    res.status(400).json({ error: "Each photo must be under 8MB." });
    return;
  }
  if (heroBuffer.length + garmentBuffer.length > MAX_TOTAL_BYTES) {
    res.status(400).json({ error: "Total photo size is too large. Please upload smaller images." });
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "outfit-swap-retry-"));
  try {
    const heroFile = path.join(tmpDir, `${randomUUID()}-hero.png`);
    const garmentFile = path.join(tmpDir, `${randomUUID()}-garment-${garmentIndex}.png`);
    await fs.writeFile(heroFile, heroBuffer);
    await fs.writeFile(garmentFile, garmentBuffer);
    const editPrompt = buildFashionPrompt(
      "outfit_swap",
      safeDescription,
      "Image 1 is the locked base hero photo. Image 2 is the selected garment design. Replace only the clothing on the existing model.",
    );
    const buffer = await generateWithVisualQa({
      operation: "outfit_swap",
      prompt: editPrompt,
      brief: safeDescription,
      references: [heroBuffer, garmentBuffer],
      generate: (retryPrompt) => editImages([heroFile, garmentFile], retryPrompt),
    });
    res.json({ garmentIndex, b64_json: buffer.toString("base64") });
  } catch (err) {
    // Keep the existing successful results on the client and expose only a
    // concise retry-safe message rather than provider details.
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "This garment did not meet the quality check. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Garment quality verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "This garment could not be generated. Please try again." });
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
