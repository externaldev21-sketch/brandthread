import { Router } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { editImages, generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";

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

  const { prompt, referenceImage } = req.body ?? {};
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const safePrompt = prompt.trim().slice(0, 500); // prevent prompt injection via overly long input

  const fullPrompt = referenceImage
    ? `Edit the provided source image according to this brand owner's direction: "${safePrompt}". Preserve the specific design, artwork, logo, silhouette, and other source details unless the direction explicitly requests changing them. Produce a polished, high-resolution apparel design or product mockup that remains visibly connected to the provided source.`
    : `Photorealistic clothing product mockup based on this brand owner's description: "${safePrompt}". Show the design applied to a garment (t-shirt, hoodie, or similar apparel) on a clean studio background, professional product photography lighting, realistic fabric texture and folds, high resolution, e-commerce ready.`;

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
      buffer = await editImages([sourcePath], fullPrompt);
    } else {
      buffer = await generateImageBuffer(fullPrompt, "1024x1024");
    }
    res.json({ b64_json: buffer.toString("base64") });
  } catch (_err) {
    // Do not leak upstream provider error details to the client.
    res.status(502).json({ error: "Mockup generation failed. Please try again." });
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
