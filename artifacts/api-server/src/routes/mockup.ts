import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";

const router = Router();
router.use(requireAuth);

// Simple in-process rate limiter: max 5 generations per user per minute.
const userHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

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

// POST /api/mockup/generate  { prompt: string }
router.post("/generate", async (req, res) => {
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many mockup generations. Please wait a minute and try again." });
    return;
  }

  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const safePrompt = prompt.trim().slice(0, 500); // prevent prompt injection via overly long input

  const fullPrompt = `Photorealistic clothing product mockup based on this brand owner's description: "${safePrompt}". Show the design applied to a garment (t-shirt, hoodie, or similar apparel) on a clean studio background, professional product photography lighting, realistic fabric texture and folds, high resolution, e-commerce ready.`;

  try {
    const buffer = await generateImageBuffer(fullPrompt, "1024x1024");
    res.json({ b64_json: buffer.toString("base64") });
  } catch (_err) {
    // Do not leak upstream provider error details to the client.
    res.status(502).json({ error: "Mockup generation failed. Please try again." });
  }
});

export default router;
