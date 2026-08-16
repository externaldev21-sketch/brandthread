import { Router } from "express";
import { db, storefronts } from "@workspace/db";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { requireAuth } from "../middlewares/requireAuth";
import { generateText } from "@workspace/integrations-openai-ai-server/text";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

function parseStoreJson(raw: string): Record<string, unknown> {
  const clean = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try { return JSON.parse(clean); } catch { return {}; }
}

// POST /api/store/ai/generate — generate store from questionnaire answers
router.post("/generate", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const { answers } = req.body;
  if (!answers) { res.status(400).json({ error: "answers required" }); return; }

  const prompt = `Generate a store configuration for a seller with these details:\n${JSON.stringify(answers, null, 2)}`;
  const raw = await generateText(SYSTEM, prompt);
  const config = parseStoreJson(raw);

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

// POST /api/store/ai/from-logo — extract palette from logo using GPT-4o vision
router.post("/from-logo", async (req, res): Promise<void> => {
  const { base64, answers } = req.body;
  if (!base64) { res.status(400).json({ error: "base64 image required" }); return; }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "low" },
            },
            {
              type: "text",
              text: `Analyze this brand logo and generate a complete store configuration that matches its visual identity, color palette, and brand personality. Additional context: ${JSON.stringify(answers ?? {})}`,
            },
          ] as any,
        },
      ],
      max_tokens: 1500,
    });
    const config = parseStoreJson(response.choices[0]?.message?.content ?? "{}");
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/store/ai/from-moodboard — generate from moodboard images using GPT-4o vision
router.post("/from-moodboard", async (req, res): Promise<void> => {
  const { base64List, answers } = req.body;
  if (!base64List?.length) { res.status(400).json({ error: "base64List required" }); return; }

  try {
    // Send up to 4 images to stay within token budget
    const imageContent = (base64List as string[]).slice(0, 4).map((b64: string) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" as const },
    }));

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            ...imageContent,
            {
              type: "text" as const,
              text: `Analyze these ${base64List.length} mood board images and generate a store configuration that captures their collective visual aesthetic, color palette, and brand mood. Additional context: ${JSON.stringify(answers ?? {})}`,
            },
          ] as any,
        },
      ],
      max_tokens: 1500,
    });
    const config = parseStoreJson(response.choices[0]?.message?.content ?? "{}");
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/store/ai/from-social — generate from social media account or screenshots
router.post("/from-social", async (req, res): Promise<void> => {
  const { socialUrl, base64List, ...answers } = req.body;
  if (!socialUrl) { res.status(400).json({ error: "socialUrl required" }); return; }

  // Vision-based analysis when screenshots are provided
  if (Array.isArray(base64List) && base64List.length > 0) {
    try {
      const imageContent = (base64List as string[]).slice(0, 4).map((b64: string) => ({
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" as const },
      }));
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              ...imageContent,
              {
                type: "text" as const,
                text: `Analyze these social media screenshots for brand "${socialUrl}" and create a matching store configuration that mirrors the visual style, color palette, layout, and brand personality.`,
              },
            ] as any,
          },
        ],
        max_tokens: 1500,
      });
      const config = parseStoreJson(response.choices[0]?.message?.content ?? "{}");
      res.json({ config }); return;
    } catch { /* fall through to text-based */ }
  }

  // Text-based fallback using social URL / post context
  const prompt = `Design a store inspired by the brand aesthetic from this social media account: ${socialUrl}
Additional context: ${JSON.stringify(answers)}
Match the visual style, tone, and target audience of the brand.`;
  const raw = await generateText(SYSTEM, prompt);
  const config = parseStoreJson(raw);
  res.json({ config });
});

export default router;
