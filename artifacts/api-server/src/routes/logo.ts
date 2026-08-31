import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  buildFashionPrompt,
  generateImageBuffer,
  generateWithVisualQa,
  ImageQualityError,
  ImageQualityUnavailableError,
} from "@workspace/integrations-openai-ai-server/image";

const router = Router();
const styleGuides: Record<string, string> = {
  Minimalist: "clean minimal flat design, simple geometric shapes, monochrome or two-tone palette, lots of white space",
  Bold:       "strong bold typography, high contrast colors, striking graphic design, powerful visual impact",
  Vintage:    "retro vintage aesthetic, distressed textures, muted earthy tones, classic badge-style composition",
  Luxury:     "elegant luxury branding, gold accents, premium feel, refined typography, dark rich background",
  Streetwear: "urban streetwear aesthetic, graffiti-inspired, black and white with a pop of color, edgy graphic",
  Playful:    "fun playful colorful design, rounded shapes, bright vibrant colors, friendly approachable feel",
};
  const { brandName, style } = req.body ?? {};
  if (!brandName || typeof brandName !== "string" || brandName.trim().length === 0) {
    res.status(400).json({ error: "brandName is required" });
    return;
  }

  const logoStyle = typeof style === "string" && styleGuides[style] ? style : "Minimalist";
  const guide = styleGuides[logoStyle];
  const safeName = brandName.trim().slice(0, 60); // prevent prompt injection via long names

  const brief = `Brand name: "${safeName}". Style: ${guide}. Use the exact brand name or its exact initials only.`;
  const prompt = buildFashionPrompt(
    "logo",
    brief,
    "Create a crisp fashion-brand logo on a clean background. It must remain legible at small sizes and contain no invented words.",
  );

  try {
    const buffer = await generateWithVisualQa({
      operation: "logo",
      prompt,
      brief,
      generate: (retryPrompt) => generateImageBuffer(retryPrompt, "1024x1024"),
    });
    res.json({ b64_json: buffer.toString("base64") });
  } catch (err) {
    // Do not leak upstream provider error details to the client.
    if (err instanceof ImageQualityError) {
      res.status(422).json({ error: "The generated logo did not meet the quality check. Please try again.", retryable: true });
    } else if (err instanceof ImageQualityUnavailableError) {
      res.status(502).json({ error: "Logo quality verification is temporarily unavailable. Please try again.", retryable: true });
    } else {
      res.status(502).json({ error: "Logo generation failed. Please try again." });
    }
  }
});

export default router;
