import { Router, type Request, type Response } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { AI_FAILED_UNITS_LOCAL } from "../lib/aiCredits/catalogue";
import {
  buildFashionPrompt,
  editImages,
  generateWithVisualQa,
  ImageQualityError,
  ImageQualityUnavailableError,
  type ImageEditSize,
} from "@workspace/integrations-openai-ai-server/image";
import { AiProviderNotConfiguredError } from "../lib/aiImageProviders/routing";
import {
  generateShot,
  ImageEngineNotConfiguredError,
  mapWithConcurrency,
  parseAspectRatio,
  type ShotOutput,
} from "../lib/aiImageEngine";
import { GeminiImageError } from "../lib/aiImageEngine/gemini";

const router = Router();
router.use(requireAuth);

const MAX_IMAGES = 4; // outfit swap: garments per batch
const MAX_REFS = 5; // mockup_to_model specific: up to 5 reference images
// AI Photoshoot: the seller's product photos and their creative references
// have separate budgets (the app's pickers use the same numbers).
const MAX_PRODUCT_IMAGES = 4;
const MAX_REFERENCE_IMAGES = 6;
const MAX_TOTAL_BYTES_PHOTOSHOOT = 30 * 1024 * 1024;
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

/**
 * Maps the seller's aspect-ratio choice to the nearest output size the OpenAI
 * edit endpoint supports (kept for callers and tests of the OpenAI path; the
 * Gemini engine honours the exact ratio).
 */
export function photoshootSizeForRatio(ratio: unknown): ImageEditSize | undefined {
  if (typeof ratio !== "string") return undefined;
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(ratio.trim());
  if (!match) return undefined;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return undefined;
  if (w === h) return "1024x1024";
  return w < h ? "1024x1536" : "1536x1024";
}

const STYLE_RE = /^[a-z_]{1,24}$/;
function styleField(value: unknown): string | undefined {
  return typeof value === "string" && STYLE_RE.test(value) ? value : undefined;
}

function briefField(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

/** Decodes a list of data-URL photos, answering 400 itself on the first bad one. */
function decodeList(
  list: unknown,
  what: string,
  max: number,
  res: Response,
): Buffer[] | null {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    res.status(400).json({ error: `${what} must be a list of photos.` });
    return null;
  }
  if (list.length > max) {
    res.status(400).json({ error: `Please use at most ${max} ${what.toLowerCase()}.` });
    return null;
  }
  const out: Buffer[] = [];
  for (const item of list) {
    const buffer = typeof item === "string" ? decodeDataUrl(item) : null;
    if (!buffer) {
      res.status(400).json({ error: "One or more photos are not valid images. Please re-upload." });
      return null;
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: "Each photo must be under 8MB." });
      return null;
    }
    out.push(buffer);
  }
  return out;
}

/**
 * Engine/provider failures as a client-safe status + body. A missing image key
 * is a 503 naming the one secret to add; nothing upstream is ever echoed.
 */
function engineFailure(err: unknown, fallback: string): { status: number; body: Record<string, unknown> } {
  if (err instanceof ImageEngineNotConfiguredError) {
    return {
      status: 503,
      body: { error: "AI photos aren't switched on for this app yet. Please try again later.", code: err.code, missingKey: err.missingKey, retryable: false },
    };
  }
  if (err instanceof AiProviderNotConfiguredError) {
    return { status: 503, body: { error: err.message, code: err.code, retryable: false } };
  }
  if (err instanceof ImageQualityError) {
    return { status: 422, body: { error: "The photo didn't pass our quality check. Please try again.", retryable: true } };
  }
  if (err instanceof ImageQualityUnavailableError) {
    return { status: 502, body: { error: "Photo quality verification is temporarily unavailable. Please try again.", retryable: true } };
  }
  if (err instanceof GeminiImageError && err.kind === "blocked") {
    return { status: 422, body: { error: "This combination of photos and description couldn't be generated. Try different photos or wording.", retryable: false } };
  }
  return { status: 502, body: { error: fallback, retryable: true } };
}

/** Aborts provider work when the seller leaves the screen (the app cancels its request). */
function abortOnClientGone(req: Request, res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  void req;
  return controller.signal;
}

function shotJson(shot: ShotOutput) {
  return { b64_json: shot.image.toString("base64"), mime: shot.mime, provider: shot.provider, ...(shot.model ? { model: shot.model } : {}) };
}

// POST /api/photography/generate — AI Photoshoot, one shot per call.
// { productImages: string[] (1-4, the seller's product, ground truth),
//   referenceImages?: string[] (0-6, creative direction),
//   prompt?, ratio?, modelStyle?, sceneStyle?, lightingStyle?, shotIndex?, shotCount? }
// Legacy { images: string[] } is still accepted and treated as product photos.
router.post("/generate", async (req, res) => {
  const body = req.body ?? {};
  const products = decodeList(body.productImages ?? body.images, "Product photos", MAX_PRODUCT_IMAGES, res);
  if (!products) return;
  const references = decodeList(body.referenceImages, "Reference photos", MAX_REFERENCE_IMAGES, res);
  if (!references) return;
  if (products.length === 0) {
    res.status(400).json({ error: "At least one product photo is required." });
    return;
  }
  const totalBytes = [...products, ...references].reduce((n, b) => n + b.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES_PHOTOSHOOT) {
    res.status(400).json({ error: "Total photo size is too large. Please upload smaller or fewer photos." });
    return;
  }

  const shotCount = Number.isInteger(body.shotCount) ? Math.min(Math.max(body.shotCount, 1), 4) : 1;
  const shotIndex = Number.isInteger(body.shotIndex) ? Math.min(Math.max(body.shotIndex, 0), shotCount - 1) : 0;
  try {
    const shot = await generateShot({
      task: "photoshoot",
      productImages: products,
      referenceImages: references,
      brief: briefField(body.prompt),
      aspectRatio: parseAspectRatio(body.ratio),
      modelStyle: styleField(body.modelStyle),
      sceneStyle: styleField(body.sceneStyle),
      lightingStyle: styleField(body.lightingStyle),
      shotIndex,
      shotCount,
      signal: abortOnClientGone(req, res),
    });
    res.json(shotJson(shot));
  } catch (err) {
    if (res.headersSent || res.destroyed) return;
    const { status, body: out } = engineFailure(err, "Photo generation failed. Please try again.");
    if (status >= 500) req.log?.error({ err }, "AI photoshoot generation failed");
    res.status(status).json(out);
  }
});

// POST /api/photography/mockup-to-model
// Dedicated contract: exactly one mockup + 1–5 reference images.
// Returns one output per reference, preserving stable input/result indices.
// Partial failures are exposed per-index; never returns fabricated fallback.
router.post("/mockup-to-model", async (req, res) => {
  const { mockup, references, prompt, ratio } = req.body ?? {};

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

  // Decode and validate all reference images up front.
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

  const brief = briefField(prompt);
  const aspectRatio = parseAspectRatio(ratio) ?? "4:5";
  const signal = abortOnClientGone(req, res);

  // Bounded concurrency; results keep their input index.
  const settled = await mapWithConcurrency(refBuffers, MOCKUP_TO_MODEL_CONCURRENCY, (refBuffer) =>
    generateShot({ task: "mockup_to_model", productImages: [mockupBuffer], referenceImages: [refBuffer], brief, aspectRatio, signal }),
  );
  if (res.headersSent || res.destroyed) return;

  const results: Array<{ refIndex: number } & ReturnType<typeof shotJson>> = [];
  const errors: { refIndex: number; error: string; retryable: boolean }[] = [];
  let notConfigured: ReturnType<typeof engineFailure> | null = null;
  let providerFailureCount = 0;
  settled.forEach((r, refIndex) => {
    if (r.status === "fulfilled") {
      results.push({ refIndex, ...shotJson(r.value) });
      return;
    }
    const failure = engineFailure(r.reason, "Generation failed for this reference. Please retry.");
    if (failure.status === 503) notConfigured = failure;
    if (failure.status >= 500) providerFailureCount++;
    errors.push({ refIndex, error: String(failure.body.error), retryable: failure.body.retryable !== false });
  });

  if (notConfigured) {
    const { status, body } = notConfigured as ReturnType<typeof engineFailure>;
    res.status(status).json(body);
    return;
  }
  if (results.length === 0) {
    // All failed — never return fabricated fallback.
    req.log?.error({ errors: settled.map((r) => (r.status === "rejected" ? String(r.reason) : null)) }, "Mockup to Model: every reference failed");
    res.status(providerFailureCount > 0 ? 502 : 422).json({
      error: "No reference images could be generated. Please retry.",
      retryable: true,
      results: [],
      errors,
    });
    return;
  }

  // At least one succeeded — return partial results with per-index errors.
  // The credits gate gives back the failed references (charged per reference).
  res.locals[AI_FAILED_UNITS_LOCAL] = errors.length;
  res.json({ results, ...(errors.length > 0 ? { errors } : {}) });
});

// POST /api/photography/mockup-to-model/retry
// Retry a single failed reference without discarding successful outputs.
router.post("/mockup-to-model/retry", async (req, res) => {
  const { mockup, reference, refIndex, prompt, ratio } = req.body ?? {};

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

  try {
    const shot = await generateShot({
      task: "mockup_to_model",
      productImages: [mockupBuffer],
      referenceImages: [refBuffer],
      brief: briefField(prompt),
      aspectRatio: parseAspectRatio(ratio) ?? "4:5",
      signal: abortOnClientGone(req, res),
    });
    res.json({ refIndex, ...shotJson(shot) });
  } catch (err) {
    if (res.headersSent || res.destroyed) return;
    const { status, body } = engineFailure(err, "This reference could not be generated. Please try again.");
    res.status(status).json(body);
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
    // The credits gate gives back the failed garments (charged per garment).
    res.locals[AI_FAILED_UNITS_LOCAL] = errors.length;
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
