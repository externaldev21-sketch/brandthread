import { Router } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { editImages } from "@workspace/integrations-openai-ai-server/image";

const router = Router();
router.use(requireAuth);

// Simple in-process rate limiter: max 5 generations per user per minute.
const userHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const MAX_IMAGES_PER_GROUP = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per photo
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 30MB across all photos

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

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

function decodeDataUrl(input: string): Buffer | null {
  const match = /^data:image\/[a-zA-Z0-9+.-]+;base64,([A-Za-z0-9+/]+=*)$/.exec(input);
  if (!match) return null;
  const base64 = match[1];
  if (!base64 || !BASE64_RE.test(base64)) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function validateImageGroup(images: unknown, label: string, res: import("express").Response): string[] | null {
  if (!Array.isArray(images) || images.length === 0) {
    res.status(400).json({ error: `At least one ${label} photo is required.` });
    return null;
  }
  if (images.length > MAX_IMAGES_PER_GROUP) {
    res.status(400).json({ error: `Please upload at most ${MAX_IMAGES_PER_GROUP} ${label} photos.` });
    return null;
  }
  for (const img of images) {
    if (typeof img !== "string") {
      res.status(400).json({ error: `Each ${label} photo must be a base64-encoded image.` });
      return null;
    }
  }
  return images as string[];
}

// POST /api/lifestyle/generate  { referenceImages: string[], productImages: string[], prompt?: string }
router.post("/generate", async (req, res) => {
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many generations. Please wait a minute and try again." });
    return;
  }

  const { referenceImages, productImages, prompt } = req.body ?? {};

  const refs = validateImageGroup(referenceImages, "reference", res);
  if (!refs) return;
  const products = validateImageGroup(productImages, "product/mockup", res);
  if (!products) return;

  const allImages = [...refs, ...products];

  const safeDescription =
    typeof prompt === "string" && prompt.trim().length > 0
      ? prompt.trim().slice(0, 500)
      : "";

  // Decode and validate all photos up front (size + format) before touching disk.
  const decoded: Buffer[] = [];
  let totalBytes = 0;
  for (const img of allImages) {
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

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lifestyle-photo-"));
  const tmpFiles: string[] = [];

  try {
    for (const buffer of decoded) {
      const filePath = path.join(tmpDir, `${randomUUID()}.png`);
      await fs.writeFile(filePath, buffer);
      tmpFiles.push(filePath);
    }

    const editPrompt = `The first ${refs.length} image(s) provided are reference photos showing the desired lifestyle scene, setting, mood, and photography style. The remaining ${products.length} image(s) are the brand owner's clothing product or design mockup. Create a single photorealistic, high-end lifestyle photograph: place the exact clothing product/design from the product photo(s) naturally onto a real human model within a scene that matches the style, setting, lighting, and mood of the reference photo(s). The result must look professionally shot, not AI-generated — natural skin, natural fabric drape, realistic shadows and depth of field, magazine-quality composition. ${
      safeDescription ? `Additional direction from the brand owner: "${safeDescription}".` : ""
    }`;

    const buffer = await editImages(tmpFiles, editPrompt);
    res.json({ b64_json: buffer.toString("base64") });
  } catch (_err) {
    // Do not leak upstream provider error details to the client.
    res.status(502).json({ error: "Lifestyle photo generation failed. Please try again." });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
