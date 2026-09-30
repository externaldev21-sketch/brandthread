/**
 * fal.ai aggregator provider(s) — one account/key (FAL_KEY) gives access to
 * several underlying models fal hosts: FASHN try-on, Kling Kolors virtual
 * try-on, Google's Nano Banana / Nano Banana Pro (Gemini image edit), and
 * Qwen image edit. Research (docs/polish/ai-provider-benchmark/README.md)
 * confirmed all four are live on fal.ai's platform as of this research
 * pass; exact model slugs are read from `getFalModelSlug()` so a renamed
 * or repriced fal listing is a config change, not a code change.
 *
 * fal's synchronous `fal.run` REST endpoint (POST https://fal.run/<slug>)
 * is used here since none of these four models are documented as
 * queue-only long-running jobs at the resolutions this benchmark targets;
 * if a given slug turns out to need fal's async queue instead, that only
 * changes this file's HTTP call shape, not the ImageProvider interface.
 */
import fs from "node:fs";
import type { GenerationInput, GenerationResult, ImageProvider, ProviderId } from "../types";
import { getFalApiKey, getFalModelSlug } from "../config";

type FalVariant = "fal-fashn" | "fal-kling" | "fal-nano-banana" | "fal-qwen";

// Published/estimated per-image cost, see research doc for sources; fal
// typically passes through the underlying model's list price plus a small
// platform margin, so these are close-but-verify-at-integration-time.
const ESTIMATED_COST_USD: Record<FalVariant, number> = {
  "fal-fashn": 0.08,
  "fal-kling": 0.07,
  "fal-nano-banana": 0.15,
  "fal-qwen": 0.03,
};

const ROLE: Record<FalVariant, ImageProvider["role"]> = {
  "fal-fashn": "garment-fidelity",
  "fal-kling": "garment-fidelity",
  "fal-nano-banana": "creative-scene",
  "fal-qwen": "creative-scene",
};

const DESCRIPTION: Record<FalVariant, string> = {
  "fal-fashn": "FASHN's try-on model via fal.ai — same underlying model as fashn-direct, routed through the fal aggregator account instead of a separate FASHN key.",
  "fal-kling": "Kling Kolors virtual try-on via fal.ai — documented to hold pose/skin-tone/body-shape well through the composite; second garment-fidelity candidate alongside FASHN.",
  "fal-nano-banana": "Google's Gemini image-edit model ('Nano Banana' / 'Nano Banana Pro') via fal.ai — strong general creative-scene generation; not purpose-built for garment fidelity (see research doc's 'neutral fit' finding), so used as a stage-1 creative-scene provider in two-stage pipelines, not for garment compositing.",
  "fal-qwen": "Qwen image-edit via fal.ai — general-purpose editor, cheapest of the four; candidate stage-1 creative-scene provider when cost matters more than Nano Banana's polish.",
};

function toDataUrl(filePathOrDataUrl: string): string {
  if (filePathOrDataUrl.startsWith("data:")) return filePathOrDataUrl;
  const buf = fs.readFileSync(filePathOrDataUrl);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function isConfigured(): boolean {
  return Boolean(getFalApiKey());
}

async function generate(variant: FalVariant, input: GenerationInput): Promise<GenerationResult> {
  const apiKey = getFalApiKey();
  if (!apiKey) {
    throw new Error(`FAL_KEY is not set — ${variant} provider is not configured.`);
  }
  const slug = getFalModelSlug(variant);
  const start = Date.now();

  // fal's per-model input schemas differ; this sends the common shape
  // (image_url / ref_image_url / prompt) that fal's try-on and image-edit
  // models document — confirm the exact field names for the pinned slug
  // against fal's model page once FAL_KEY exists (see research doc).
  const body: Record<string, unknown> = {
    image_url: toDataUrl(input.productImages[0]),
    prompt: input.prompt,
  };
  if (input.referenceImages[0]) body.ref_image_url = toDataUrl(input.referenceImages[0]);
  if (input.sceneImage) body.scene_image_url = `data:image/png;base64,${input.sceneImage.toString("base64")}`;

  const res = await fetch(`https://fal.run/${slug}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`fal.ai ${slug} failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { images?: { url: string }[]; image?: { url: string } };
  const imageUrl = json.images?.[0]?.url ?? json.image?.url;
  if (!imageUrl) {
    throw new Error(`fal.ai ${slug} returned no image URL: ${JSON.stringify(json)}`);
  }
  const imgRes = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imgRes.arrayBuffer());

  return {
    imageBuffer,
    providerId: variant as ProviderId,
    costUsd: ESTIMATED_COST_USD[variant],
    latencyMs: Date.now() - start,
    meta: { falModelSlug: slug },
  };
}

function makeFalProvider(variant: FalVariant): ImageProvider {
  return {
    id: variant,
    role: ROLE[variant],
    description: DESCRIPTION[variant],
    isConfigured,
    generate: (input) => generate(variant, input),
  };
}

export const falFashnProvider = makeFalProvider("fal-fashn");
export const falKlingProvider = makeFalProvider("fal-kling");
export const falNanoBananaProvider = makeFalProvider("fal-nano-banana");
export const falQwenProvider = makeFalProvider("fal-qwen");
