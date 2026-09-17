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
const MAX_REFS = 5; // mockup_to_model specific: up to 5 reference images
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per photo
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB across all photos
// For mockup_to_model: 1 mockup + up to 5 refs; budget generously
const MAX_TOTAL_BYTES_MOCKUP_TO_MODEL = 48 * 1024 * 1024; // 48MB (6 files × 8MB)
const MOCKUP_TO_MODEL_CONCURRENCY = 2; // process 2 refs at a time

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

    const operation: ImageOperation = "photoshoot";
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

// POST /api/photography/mockup-to-model
// Dedicated contract: exactly one mockup + 1–5 reference images.
// Returns one output per reference, preserving stable input/result indices.
// Partial failures are exposed per-index; never returns fabricated fallback.
router.post("/mockup-to-model", async (req, res) => {
  const { mockup, references, prompt } = req.body ?? {};

  // --- Validate mockup ---
  if (typeof mockup !== "string" || !mockup) {
    res.status(400).json({ error: "A garment mockup image is required." });
    return;
  }
  const mockupBuffer = decodeDataUrl(mockup);
  if (!mockupBuffer) {
    res.status(400).json({ error: "The mockup image is not a valid JPEG, PNG, or WEBP. Please re-upload." });
    return;
  }
  if (mockupBuffer.length > MAX_IMAGE_BYTES) {
    res.status(400).json({ error: "The mockup image must be under 8MB." });
    return;
  }

  // --- Validate references ---
  if (!Array.isArray(references) || references.length === 0) {
    res.status(400).json({ error: "At least one reference model image is required." });
    return;
  }
  if (references.length > MAX_REFS) {
    res.status(400).json({ error: `Please upload at most ${MAX_REFS} reference images.` });
    return;
  }

  const safeDescription =
    typeof prompt === "string" && prompt.trim().length > 0
      ? prompt.trim().slice(0, 500)
      : "";

  // Decode and validate all reference images up front before touching disk.
  const refBuffers: Buffer[] = [];
  let totalBytes = mockupBuffer.length;
  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    if (typeof ref !== "string") {
      res.status(400).json({ error: `Reference image at index ${i} must be a base64-encoded image.` });
      return;
    }
    const buffer = decodeDataUrl(ref);
    if (!buffer) {
      res.status(400).json({ error: `Reference image at index ${i} is not a valid JPEG, PNG, or WEBP. Please re-upload.` });
      return;
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: `Reference image at index ${i} must be under 8MB.` });
      return;
    }
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES_MOCKUP_TO_MODEL) {
      res.status(400).json({ error: "Total image size is too large. Please upload smaller or fewer images." });
      return;
    }
    refBuffers.push(buffer);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-to-model-"));

  try {
    // Write mockup to disk once; reuse for every reference call.
    const mockupFile = path.join(tmpDir, `${randomUUID()}-mockup.png`);
    await fs.writeFile(mockupFile, mockupBuffer);

    // Write all ref files up front.
    const refFiles: string[] = [];
    for (let i = 0; i < refBuffers.length; i++) {
      const refFile = path.join(tmpDir, `${randomUUID()}-ref-${i}.png`);
      await fs.writeFile(refFile, refBuffers[i]);
      refFiles.push(refFile);
    }

    // Process references with bounded concurrency.
    // Results array preserves input order (stable indices).
    const results: { refIndex: number; b64_json: string }[] = [];
    const errors: { refIndex: number; error: string; retryable: boolean }[] = [];
    let providerFailureCount = 0;

    // Run in batches of MOCKUP_TO_MODEL_CONCURRENCY.
    for (let start = 0; start < refBuffers.length; start += MOCKUP_TO_MODEL_CONCURRENCY) {
      const batch = refBuffers.slice(start, start + MOCKUP_TO_MODEL_CONCURRENCY);
      await Promise.all(
        batch.map(async (refBuffer, batchIndex) => {
          const refIndex = start + batchIndex;
          const refFile = refFiles[refIndex];
          const editPrompt = buildFashionPrompt(
            "photoshoot" as ImageOperation,
            safeDescription,
            "Image 1 is the garment/product mockup — preserve its exact design, artwork, colors, and construction. Image 2 is the reference photo — use this person's pose, body type, and composition as the model. Generate one finished editorial photo of the model wearing the garment.",
          );
          try {
            const buffer = await generateWithVisualQa({
              operation: "photoshoot" as ImageOperation,
              prompt: editPrompt,
              brief: safeDescription,
              references: [mockupBuffer, refBuffer],
              generate: (retryPrompt) => editImages([mockupFile, refFile], retryPrompt),
            });
            results.push({ refIndex, b64_json: buffer.toString("base64") });
          } catch (err) {
            if (err instanceof ImageQualityError) {
              errors.push({
                refIndex,
                error: "This reference did not meet the quality check. Please retry.",
                retryable: true,
              });
            } else if (err instanceof ImageQualityUnavailableError) {
              errors.push({
                refIndex,
                error: "Quality verification is temporarily unavailable. Please retry.",
                retryable: true,
              });
              providerFailureCount++;
            } else {
              errors.push({
                refIndex,
                error: "Generation failed for this reference. Please retry.",
                retryable: true,
              });
              providerFailureCount++;
            }
          }
        }),
      );
    }

    // Sort results by refIndex to guarantee stable ordering.
    results.sort((a, b) => a.refIndex - b.refIndex);
    errors.sort((a, b) => a.refIndex - b.refIndex);

    if (results.length === 0 && errors.length > 0) {
      // All failed — never return fabricated fallback.
      const status = providerFailureCount > 0 ? 502 : 422;
      res.status(status).json({
        error: "No reference images could be generated. Please retry.",
        retryable: true,
        results: [],
        errors,
      });
      return;
    }

    // At least one succeeded — return partial results with per-index errors.
    res.json({
      results,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (_err) {
    res.status(502).json({ error: "Mockup to Model generation failed. Please try again." });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/photography/mockup-to-model/retry
// Retry a single failed reference without discarding successful outputs.
router.post("/mockup-to-model/retry", async (req, res) => {
  const { mockup, reference, refIndex, prompt } = req.body ?? {};

  if (typeof mockup !== "string" || !mockup) {
    res.status(400).json({ error: "A garment mockup image is required for retry." });
    return;
  }
  if (typeof reference !== "string" || !reference) {
    res.status(400).json({ error: "A reference image is required for retry." });
    return;
  }
  if (!Number.isInteger(refIndex) || refIndex < 0 || refIndex >= MAX_REFS) {
    res.status(400).json({ error: "The reference index being retried is not valid." });
    return;
  }

  const mockupBuffer = decodeDataUrl(mockup);
  const refBuffer = decodeDataUrl(reference);
  if (!mockupBuffer) {
    res.status(400).json({ error: "The mockup image is not a valid JPEG, PNG, or WEBP. Please re-upload." });
    return;
  }
  if (!refBuffer) {
    res.status(400).json({ error: "The reference image is not a valid JPEG, PNG, or WEBP. Please re-upload." });
    return;
  }
  if (mockupBuffer.length > MAX_IMAGE_BYTES || refBuffer.length > MAX_IMAGE_BYTES) {
    res.status(400).json({ error: "Each image must be under 8MB." });
    return;
  }
  if (mockupBuffer.length + refBuffer.length > MAX_TOTAL_BYTES) {
    res.status(400).json({ error: "Total image size is too large. Please upload smaller images." });
    return;
  }

  const safeDescription =
    typeof prompt === "string" && prompt.trim().length > 0
      ? prompt.trim().slice(0, 500)
      : "";

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-to-model-retry-"));
  try {
    const mockupFile = path.join(tmpDir, `${randomUUID()}-mockup.png`);
    const refFile = path.join(tmpDir, `${randomUUID()}-ref-${refIndex}.png`);
    await fs.writeFile(mockupFile, mockupBuffer);
    await fs.writeFile(refFile, refBuffer);

    const editPrompt = buildFashionPrompt(
      "photoshoot" as ImageOperation,
      safeDescription,
      "Image 1 is the garment/product mockup — preserve its exact design, artwork, colors, and construction. Image 2 is the reference photo — use this person's pose, body type, and composition as the model. Generate one finished editorial photo of the model wearing the garment.",
    );
    const buffer = await generateWithVisualQa({
      operation: "photoshoot" as ImageOperation,
      prompt: editPrompt,
      brief: safeDescription,
      references: [mockupBuffer, refBuffer],
      generate: (retryPrompt) => editImages([mockupFile, refFile], retryPrompt),
    });
    res.json({ refIndex, b64_json: buffer.toString("base64") });
  } catch (err) {
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "This reference did not meet the quality check. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Quality verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "This reference could not be generated. Please try again.", retryable: true });
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
