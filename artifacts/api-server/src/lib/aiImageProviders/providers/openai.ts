/**
 * OpenAI image-edit provider — the current production path, reimplemented
 * here as an `ImageProvider` purely so the benchmark can compare it
 * apples-to-apples against the other candidates. This does NOT replace
 * `@workspace/integrations-openai-ai-server`'s `editImages()`, which the
 * live route keeps using unchanged.
 *
 * Uses `getOpenAiImageModel()` (default `gpt-image-2.5-flare`) rather than
 * hardcoding `gpt-image-1`, since gpt-image-1 retires Oct 23, 2026 and this
 * is new code being written after that migration was already flagged.
 */
import fs from "node:fs";
import { toFile } from "openai";
import { createOpenAiClient, isOpenAiConfigured } from "@workspace/integrations-openai-ai-server/config";
import type { GenerationInput, GenerationResult, ImageProvider } from "../types";
import { getOpenAiImageModel } from "../config";

// Approximate published per-image cost for a 1024x1024 "high" quality edit.
// OpenAI has not yet published gpt-image-2.5 pricing separately at time of
// writing (see docs/polish/ai-provider-benchmark/README.md) — using the
// gpt-image-1 "high" tier ($0.167) as the placeholder baseline until the
// real successor pricing is confirmed and this constant is updated.
const ESTIMATED_COST_USD = 0.167;

function isConfigured(): boolean {
  return isOpenAiConfigured();
}

async function toOpenAiFile(filePath: string) {
  const buf = fs.readFileSync(filePath);
  const name = filePath.split("/").pop() || "image.png";
  return toFile(buf, name, { type: "image/png" });
}

async function generate(input: GenerationInput): Promise<GenerationResult> {
  const start = Date.now();
  const client = createOpenAiClient();
  const allImages = [...input.productImages, ...input.referenceImages];
  const images = await Promise.all(allImages.map(toOpenAiFile));
  const response = await client.images.edit({
    model: getOpenAiImageModel(),
    image: images,
    prompt: input.prompt || "Photorealistic product-on-model shoot, preserve the garment exactly.",
    quality: "high",
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  return {
    imageBuffer: Buffer.from(base64, "base64"),
    providerId: "openai",
    costUsd: ESTIMATED_COST_USD,
    latencyMs: Date.now() - start,
  };
}

export const openaiProvider: ImageProvider = {
  id: "openai",
  role: "creative-scene",
  description:
    "General-purpose OpenAI image-edit model (gpt-image-2.5, configurable). Today's production path for Mockup to Model and AI Photoshoot; strongest as the stage-1 'creative scene' half of a two-stage pipeline, not purpose-built for garment fidelity.",
  isConfigured,
  generate,
};
