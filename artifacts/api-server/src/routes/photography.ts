import { Router } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { editImages } from "@workspace/integrations-openai-ai-server/image";

const router = Router();
router.use(requireAuth);

// Simple in-process rate limiter: max 5 provider image edits per user per minute.
const userHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per photo
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20MB across all photos

function checkRateLimit(userId: string, cost = 1): boolean {
  const now = Date.now();
  const rec = userHits.get(userId);
  if (!rec || now >= rec.resetAt) {
    if (cost > MAX_PER_WINDOW) return false;
    userHits.set(userId, { count: cost, resetAt: now + WINDOW_MS });
    return true;
  }
  if (rec.count + cost > MAX_PER_WINDOW) return false;
  rec.count += cost;
  return true;
}

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
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many generations. Please wait a minute and try again." });
    return;
  }

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

    const editPrompt = `Using the provided clothing product photo(s) and any reference style photo(s), create a photorealistic studio product photograph. Show the clothing product worn by a realistic AI-generated human model, professional studio lighting, clean background, high-end e-commerce fashion photography quality. ${
      safeDescription ? `Additional direction from the brand owner: "${safeDescription}".` : ""
    }`;

    const buffer = await editImages(tmpFiles, editPrompt);
    res.json({ b64_json: buffer.toString("base64") });
  } catch (_err) {
    // Do not leak upstream provider error details to the client.
    res.status(502).json({ error: "Photo generation failed. Please try again." });
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
  // An Outfit Swap with N garments invokes the provider N times, so it must
  // consume N quota slots rather than bypassing the per-image generation cap.
  if (!checkRateLimit(userId, garmentImages.length)) {
    res.status(429).json({ error: "Too many generations. Please wait a minute and try again." });
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

  try {
    const heroFile = path.join(tmpDir, `${randomUUID()}-hero.png`);
    await fs.writeFile(heroFile, decoded[0]);
    tmpFiles.push(heroFile);

    for (let i = 0; i < garmentImages.length; i += 1) {
      const garmentFile = path.join(tmpDir, `${randomUUID()}-garment-${i + 1}.png`);
      await fs.writeFile(garmentFile, decoded[i + 1]);
      tmpFiles.push(garmentFile);

      const editPrompt = `This is an Outfit Swap edit. Image 1 is the locked base hero photo and Image 2 is the new garment design. Create one photorealistic fashion photo by replacing only the clothing on the model in Image 1 with the garment design from Image 2. Preserve the exact same model identity, face, hair, body proportions, pose, hand position, camera angle, crop, framing, lighting, shadows, location, background, and composition from Image 1. Do not change the model, pose, scene, background, or camera. Make the garment fit naturally on the existing model with realistic fabric texture, drape, seams, and shadows. Do not add logos or design details that are not present in Image 2. ${
        safeDescription ? `Additional direction from the brand owner: "${safeDescription}".` : ""
      }`;

      try {
        const buffer = await editImages([heroFile, garmentFile], editPrompt);
        results.push({ garmentIndex: i + 1, b64_json: buffer.toString("base64") });
      } catch {
        // Keep successful garment results when one provider call fails.
        errors.push({ garmentIndex: i + 1 });
      }
    }

    if (results.length === 0 && errors.length > 0) {
      // Return each failed garment so the client can offer targeted retries,
      // including when every garment in the batch fails.
      res.json({ results, errors });
      return;
    }
    if (results.length === 0) {
      res.status(502).json({ error: "Outfit Swap generation failed. Please try again." });
      return;
    }
    res.json({ results, ...(errors.length > 0 ? { errors } : {}) });
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
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";
  const { heroImage, garmentImage, garmentIndex, prompt } = req.body ?? {};

  if (typeof heroImage !== "string" || typeof garmentImage !== "string") {
    res.status(400).json({ error: "A hero photo and garment design are required for this retry." });
    return;
  }
  if (!Number.isInteger(garmentIndex) || garmentIndex < 1 || garmentIndex > MAX_IMAGES) {
    res.status(400).json({ error: "The garment being retried is not valid." });
    return;
  }
  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many generations. Please wait a minute and try again." });
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
    const editPrompt = `This is an Outfit Swap edit. Image 1 is the locked base hero photo and Image 2 is the new garment design. Create one photorealistic fashion photo by replacing only the clothing on the model in Image 1 with the garment design from Image 2. Preserve the exact same model identity, face, hair, body proportions, pose, hand position, camera angle, crop, framing, lighting, shadows, location, background, and composition from Image 1. Do not change the model, pose, scene, background, or camera. Make the garment fit naturally on the existing model with realistic fabric texture, drape, seams, and shadows. Do not add logos or design details that are not present in Image 2. ${
      safeDescription ? `Additional direction from the brand owner: "${safeDescription}".` : ""
    }`;
    const buffer = await editImages([heroFile, garmentFile], editPrompt);
    res.json({ garmentIndex, b64_json: buffer.toString("base64") });
  } catch (_err) {
    // Keep the existing successful results on the client and expose only a
    // concise retry-safe message rather than provider details.
    res.status(502).json({ error: "This garment could not be generated. Please try again." });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
