import { Router } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/requireAuth";
import { editImages } from "@workspace/integrations-openai-ai-server/image";

const router = Router();
router.use(requireAuth);

// Simple in-process rate limiter: max 5 removals per user per minute.
const userHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

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

// POST /api/bg-removal/remove  { image: string (data-url) }
router.post("/remove", async (req, res) => {
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
    return;
  }

  const { image } = req.body ?? {};
  if (typeof image !== "string") {
    res.status(400).json({ error: "An image is required." });
    return;
  }

  const buffer = decodeDataUrl(image);
  if (!buffer) {
    res.status(400).json({ error: "The image is not valid. Please re-upload." });
    return;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    res.status(400).json({ error: "The image must be under 8MB." });
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-removal-"));
  const tmpFile = path.join(tmpDir, `${randomUUID()}.png`);

  try {
    await fs.writeFile(tmpFile, buffer);

    const prompt =
      "Remove the background completely. Keep only the main subject/product exactly as-is, in the same position and framing, with clean precise edges. Do not add any new background, shadow, or texture.";

    const result = await editImages([tmpFile], prompt, undefined, { background: "transparent" });
    res.json({ b64_json: result.toString("base64") });
  } catch (_err) {
    // Do not leak upstream provider error details to the client.
    res.status(502).json({ error: "Background removal failed. Please try again." });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
