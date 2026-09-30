/**
 * The two pipelines under test (see docs/polish/ai-provider-benchmark).
 *
 * A. singleStage — one garment-fidelity provider call directly on the
 *    seller's reference photo. Cheapest, fastest, and what production runs
 *    today (via the OpenAI provider). Risk: one model asked to be both
 *    creative (match an exotic reference) and exacting (preserve the
 *    product) in the same pass.
 *
 * B. twoStage — a creative-scene provider builds the scene/model/pose
 *    matching the reference first, then a garment-fidelity provider
 *    composites the real product onto that scene. More expensive (two
 *    calls) and slower (sequential), but separates "be creative" from
 *    "don't touch the product" into two passes each suited to its job.
 */
import type { GenerationInput, GenerationResult, ImageProvider } from "./types";

export async function runSingleStage(
  provider: ImageProvider,
  input: GenerationInput
): Promise<GenerationResult> {
  return provider.generate(input);
}

export async function runTwoStage(
  sceneProvider: ImageProvider,
  garmentProvider: ImageProvider,
  input: GenerationInput
): Promise<GenerationResult> {
  const start = Date.now();

  // Stage 1: creative scene, no real product in frame — the reference
  // photo(s) drive scene/model/pose/lighting.
  const stage1 = await sceneProvider.generate({
    productImages: [],
    referenceImages: input.referenceImages,
    prompt: input.prompt,
  });

  // Stage 2: garment-locked compositing of the real product onto stage 1's scene.
  const stage2 = await garmentProvider.generate({
    productImages: input.productImages,
    referenceImages: input.referenceImages,
    prompt: input.prompt,
    sceneImage: stage1.imageBuffer,
  });

  return {
    imageBuffer: stage2.imageBuffer,
    providerId: stage2.providerId,
    costUsd: stage1.costUsd + stage2.costUsd,
    latencyMs: Date.now() - start,
    meta: {
      pipeline: "two-stage",
      stage1: { providerId: stage1.providerId, latencyMs: stage1.latencyMs, costUsd: stage1.costUsd },
      stage2: { providerId: stage2.providerId, latencyMs: stage2.latencyMs, costUsd: stage2.costUsd },
    },
  };
}
