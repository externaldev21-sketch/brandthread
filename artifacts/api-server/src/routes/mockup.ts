import { Router } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import {
  buildFashionPrompt,
  editImages,
  generateImageBuffer,
  generateWithVisualQa,
  ImageQualityError,
  ImageQualityUnavailableError,
  type ImageOperation,
} from "@workspace/integrations-openai-ai-server/image";

const router = Router();
router.use(requireAuth);

// Simple in-process rate limiter: max 5 generations per user per minute.
const userHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const rec = userHits.get(userId);
  if (!rec || now >= rec.resetAt) {
    userHits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (rec.count >= MAX_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

function decodeReferenceImage(input: unknown): Buffer | null {
  if (typeof input !== "string") return null;
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(input);
  if (!match || !ALLOWED_IMAGE_MIMES.has(match[1].toLowerCase()) || !BASE64_RE.test(match[2])) return null;
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
    const mime = match[1].toLowerCase();
    const validSignature =
      (mime === "image/png" && buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (mime === "image/jpeg" && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
      (mime === "image/webp" && buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP");
    return validSignature ? buffer : null;
  } catch {
    return null;
  }
}

// POST /api/mockup/generate  { prompt: string, referenceImage?: data-url }
router.post("/generate", async (req, res) => {
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many mockup generations. Please wait a minute and try again." });
    return;
  }

  const { prompt, referenceImage, mode } = req.body ?? {};
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const safePrompt = prompt.trim().slice(0, 500); // prevent prompt injection via overly long input

  const allowedModes = new Set<ImageOperation>(["text_to_design", "sketch_to_design", "prompt_edit"]);
  const operation: ImageOperation = allowedModes.has(mode) ? mode : (referenceImage ? "prompt_edit" : "text_to_design");
  const fullPrompt = buildFashionPrompt(
    operation,
    safePrompt,
    referenceImage
      ? "Image 1 is the authoritative source design. Apply only the requested change and preserve every unrequested source detail."
      : "Create a polished production-aware apparel design or product mockup on a clean presentation background.",
  );

  const decodedReference = referenceImage === undefined ? null : decodeReferenceImage(referenceImage);
  if (referenceImage !== undefined && !decodedReference) {
    res.status(400).json({ error: "referenceImage must be a valid PNG, JPEG, or WEBP image under 8MB." });
    return;
  }

  let tmpDir: string | null = null;
  try {
    let buffer: Buffer;
    if (decodedReference) {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-reference-"));
      const sourcePath = path.join(tmpDir, `${randomUUID()}.png`);
      await fs.writeFile(sourcePath, decodedReference);
      buffer = await generateWithVisualQa({
        operation,
        prompt: fullPrompt,
        brief: safePrompt,
        references: [decodedReference],
        generate: (retryPrompt) => editImages([sourcePath], retryPrompt),
      });
    } else {
      buffer = await generateWithVisualQa({
        operation,
        prompt: fullPrompt,
        brief: safePrompt,
        generate: (retryPrompt) => generateImageBuffer(retryPrompt, "1024x1024"),
      });
    }
    res.json({ b64_json: buffer.toString("base64") });
  } catch (err) {
    // Do not leak upstream provider error details to the client.
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "The generated design did not meet the quality check. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Design quality verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "Mockup generation failed. Please try again." });
    }
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
