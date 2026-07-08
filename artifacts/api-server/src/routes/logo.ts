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

const styleGuides: Record<string, string> = {
  Minimalist: "clean minimal flat design, simple geometric shapes, monochrome or two-tone palette, lots of white space",
  Bold:       "strong bold typography, high contrast colors, striking graphic design, powerful visual impact",
  Vintage:    "retro vintage aesthetic, distressed textures, muted earthy tones, classic badge-style composition",
  Luxury:     "elegant luxury branding, gold accents, premium feel, refined typography, dark rich background",
  Streetwear: "urban streetwear aesthetic, graffiti-inspired, black and white with a pop of color, edgy graphic",
  Playful:    "fun playful colorful design, rounded shapes, bright vibrant colors, friendly approachable feel",
};

// POST /api/logo/generate  { brandName, style }
router.post("/generate", async (req, res) => {
  const userId = (req as any).auth?.userId ?? (req as any).auth?.sub ?? "anon";

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Too many logo generations. Please wait a minute and try again." });
    return;
  }

  const { brandName, style } = req.body ?? {};
  if (!brandName || typeof brandName !== "string" || brandName.trim().length === 0) {
    res.status(400).json({ error: "brandName is required" });
    return;
  }

  const logoStyle = typeof style === "string" && styleGuides[style] ? style : "Minimalist";
  const guide = styleGuides[logoStyle];
  const safeName = brandName.trim().slice(0, 60); // prevent prompt injection via long names

  const prompt = `Professional brand logo for "${safeName}". Style: ${guide}. The logo should feature the brand initials or a simple icon. No text other than possibly the brand initials. Clean background, suitable for a clothing brand. High quality, vector-style illustration.`;

  try {
    const buffer = await generateImageBuffer(prompt, "1024x1024");
    res.json({ b64_json: buffer.toString("base64") });
  } catch (_err) {
    // Do not leak upstream provider error details to the client.
    res.status(502).json({ error: "Logo generation failed. Please try again." });
  }
});

export default router;
