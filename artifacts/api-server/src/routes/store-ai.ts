import { Router } from "express";
import { db, storefronts } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { generateText } from "@workspace/integrations-openai-ai-server/text";

const router = Router();
router.use(requireAuth);

// ─── Shared system prompt ─────────────────────────────────────────────────────
const SYSTEM = `You are a professional Brandthread store designer. 
Given seller answers or visual references, generate a complete store configuration as JSON.
Always respond ONLY with valid JSON matching this schema:
{
  "title": string,
  "subtitle": string,
  "description": string,
  "theme": {
    "primaryColor": string (hex),
    "secondaryColor": string (hex),
    "backgroundColor": string (hex),
    "textColor": string (hex),
    "fontFamily": string,
    "borderRadius": number
  },
  "branding": {
    "tagline": string,
    "mission": string,
    "targetAudience": string
  },
  "sections": [
    { "type": "hero" | "products" | "about" | "story" | "testimonials" | "newsletter", "title": string, "content": string }
  ],
  "seo": {
    "metaTitle": string,
    "metaDescription": string,
    "keywords": string[]
  }
}`;

function parseStoreJson(text: string): Record<string, unknown> {
  // Strip markdown code fences if present
  const clean = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try { return JSON.parse(clean); } catch { return {}; }
}

// POST /api/store/ai/generate — generate store from questionnaire answers
router.post("/generate", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { answers } = req.body;
  if (!answers) return res.status(400).json({ error: "answers required" });

  const prompt = `Generate a store configuration for a seller with these details:\n${JSON.stringify(answers, null, 2)}`;

  const { text } = await generateText({ system: SYSTEM, prompt });
  const config = parseStoreJson(text);

  // Save generated config to the seller's storefront
  const existing = await db.select().from(storefronts).where(eq(storefronts.ownerId, ownerId)).limit(1);
  if (existing[0]) {
    await db.update(storefronts).set({
      title:       (config.title as string) ?? existing[0].title,
      subtitle:    (config.subtitle as string) ?? null,
      description: (config.description as string) ?? null,
      theme:       config.theme ?? {},
      branding:    config.branding ?? {},
      sections:    config.sections ?? [],
      seo:         config.seo ?? {},
      updatedAt:   new Date(),
    } as any).where(eq(storefronts.ownerId, ownerId));
  }

  res.json({ config });
});

// POST /api/store/ai/from-logo — extract palette from logo image URL
router.post("/from-logo", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { logoUrl, answers } = req.body;
  if (!logoUrl) return res.status(400).json({ error: "logoUrl required" });

  // For logo-based generation, describe what we want using text-only for now
  // (Vision API requires direct openai client which may not be available)
  const prompt = `Design a store themed around a brand whose logo is at: ${logoUrl}
Additional context: ${JSON.stringify(answers ?? {})}
Create a cohesive color scheme and store layout inspired by the brand identity.`;

  const { text } = await generateText({ system: SYSTEM, prompt });
  const config = parseStoreJson(text);
  res.json({ config });
});

// POST /api/store/ai/from-moodboard — generate from moodboard images
router.post("/from-moodboard", async (req, res) => {
  const { imageUrls, answers } = req.body;
  if (!imageUrls?.length) return res.status(400).json({ error: "imageUrls required" });

  const prompt = `Design a store inspired by this moodboard (${imageUrls.length} images at: ${imageUrls.join(", ")}).
Additional context: ${JSON.stringify(answers ?? {})}
Extract the visual aesthetic and apply it to the store design.`;

  const { text } = await generateText({ system: SYSTEM, prompt });
  const config = parseStoreJson(text);
  res.json({ config });
});

// POST /api/store/ai/from-social — generate from social media account
router.post("/from-social", async (req, res) => {
  const { socialUrl, answers } = req.body;
  if (!socialUrl) return res.status(400).json({ error: "socialUrl required" });

  const prompt = `Design a store inspired by the brand aesthetic from this social media account: ${socialUrl}
Additional context: ${JSON.stringify(answers ?? {})}
Match the visual style, tone, and target audience of the brand.`;

  const { text } = await generateText({ system: SYSTEM, prompt });
  const config = parseStoreJson(text);
  res.json({ config });
});

export default router;
