/**
 * The one image-generation engine behind Mockup to Model and AI Photoshoot.
 * Both tools send the seller's product photos (ground truth), their reference
 * photos (direction) and their brief through here, so they share one provider
 * choice and one prompting standard (prompts.ts).
 *
 * Provider, in order:
 *   1. AI_IMAGE_<TOOL>_PROVIDER set to a non-OpenAI provider (fal.ai / FASHN,
 *      see lib/aiImageProviders): that provider, as before.
 *   2. Google Gemini image ("Nano Banana Pro") when a Gemini key is set
 *      (gemini.ts). Preferred: it composes many labelled reference images
 *      into one photo and honours the exact aspect ratio at 2K.
 *   3. OpenAI image edit through the existing integration.
 *   Neither key -> ImageEngineNotConfiguredError, which names GEMINI_API_KEY.
 *
 * When OpenAI is configured, each shot also passes the existing strict visual
 * QA (generate -> inspect -> one corrected retry). Without it, shots are
 * returned unverified rather than refused.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  editImages,
  generateWithVisualQa,
  type ImageEditSize,
  type ImageOperation,
} from "@workspace/integrations-openai-ai-server/image";
import { isOpenAiConfigured } from "@workspace/integrations-openai-ai-server/config";
import { isProviderId, type AiTool } from "../aiImageProviders/config";
import { resolveToolGenerator } from "../aiImageProviders/routing";
import { generateWithGemini, resolveGeminiConfig, type GeminiPart } from "./gemini";
import {
  buildFlatPrompt,
  buildShotDirection,
  PRODUCT_LABEL,
  REFERENCE_LABEL,
  type AspectRatio,
  type EngineTask,
  type ShotDirection,
} from "./prompts";

export { parseAspectRatio, ASPECT_RATIOS, type AspectRatio, type EngineTask } from "./prompts";
export { resolveGeminiConfig } from "./gemini";

/** The one key the owner needs to add to unlock the preferred engine. */
export const PREFERRED_IMAGE_KEY = "GEMINI_API_KEY";

export type EngineProvider = "gemini" | "openai" | "env-override";

export class ImageEngineNotConfiguredError extends Error {
  readonly code = "ai_image_engine_not_configured";
  readonly missingKey = PREFERRED_IMAGE_KEY;
  constructor() {
    super(`No image model is configured. Add ${PREFERRED_IMAGE_KEY} to the API server's secrets.`);
    this.name = "ImageEngineNotConfiguredError";
  }
}

const TASK_TOOL: Record<EngineTask, AiTool> = { mockup_to_model: "mockup-to-model", photoshoot: "ai-photoshoot" };

export function activeImageProvider(task: EngineTask, env: Record<string, string | undefined> = process.env): EngineProvider | null {
  const override = env[`AI_IMAGE_${TASK_TOOL[task].toUpperCase().replace(/-/g, "_")}_PROVIDER`];
  // Only a provider id config.ts recognises: an unknown value (a typo) is ignored there too, and
  // treating it as an override would leave generateShot with no generator to call.
  if (isProviderId(override) && override !== "openai") return "env-override";
  if (resolveGeminiConfig(env)) return "gemini";
  if (isOpenAiConfigured(env)) return "openai";
  return null;
}

export interface ShotInput extends Omit<ShotDirection, "productCount" | "referenceCount"> {
  productImages: Buffer[];
  referenceImages: Buffer[];
  signal?: AbortSignal;
}

export interface ShotOutput {
  image: Buffer;
  mime: "image/jpeg";
  provider: EngineProvider;
  model?: string;
}

/** Normalises an upload for the model: EXIF-rotated, at most 2048px, sRGB JPEG. */
async function prepareInput(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

/** Output is delivered as a high-quality JPEG: a 2K PNG would be ~4x the payload for no visible gain. */
async function finishOutput(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: "none" }).jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

/** Nearest output canvas the OpenAI edit endpoint offers for a requested ratio. */
export function openAiSizeForRatio(ratio: AspectRatio | undefined): ImageEditSize | undefined {
  if (!ratio) return undefined;
  const [w, h] = ratio.split(":").map(Number) as [number, number];
  if (w === h) return "1024x1024";
  return w < h ? "1024x1536" : "1536x1024";
}

async function withTempFiles<T>(buffers: Buffer[], run: (files: string[]) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-image-engine-"));
  try {
    const files: string[] = [];
    for (const buffer of buffers) {
      const file = path.join(dir, `${randomUUID()}.jpg`);
      await fs.writeFile(file, buffer);
      files.push(file);
    }
    return await run(files);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function geminiParts(task: EngineTask, products: Buffer[], references: Buffer[], direction: string): GeminiPart[] {
  const parts: GeminiPart[] = [];
  products.forEach((img, i) => {
    parts.push({ text: PRODUCT_LABEL(i, products.length) });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } });
  });
  references.forEach((img, i) => {
    parts.push({ text: REFERENCE_LABEL(task, i, references.length) });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } });
  });
  parts.push({ text: direction });
  return parts;
}

/** Generates one shot. Throws ImageEngineNotConfiguredError, AiProviderNotConfiguredError, provider or QA errors. */
export async function generateShot(input: ShotInput): Promise<ShotOutput> {
  const provider = activeImageProvider(input.task);
  if (!provider) throw new ImageEngineNotConfiguredError();

  const [products, references] = await Promise.all([
    Promise.all(input.productImages.map(prepareInput)),
    Promise.all(input.referenceImages.map(prepareInput)),
  ]);
  const direction: ShotDirection = { ...input, productCount: products.length, referenceCount: references.length };
  const operation: ImageOperation = input.task;
  const withQa = (generate: (correction: string) => Promise<Buffer>, basePrompt: string) =>
    isOpenAiConfigured()
      ? generateWithVisualQa({
          operation,
          prompt: basePrompt,
          brief: input.brief ?? "",
          references: [...products, ...references],
          generate,
        })
      : generate(basePrompt);

  if (provider === "gemini") {
    const cfg = resolveGeminiConfig()!;
    const base = buildShotDirection(direction);
    let model: string | undefined;
    const image = await withQa(async (prompt) => {
      const r = await generateWithGemini(cfg, geminiParts(input.task, products, references, prompt), {
        aspectRatio: input.aspectRatio,
        signal: input.signal,
      });
      model = r.model;
      return r.image;
    }, base);
    return { image: await finishOutput(image), mime: "image/jpeg", provider, model };
  }

  const flat = buildFlatPrompt(direction);
  return withTempFiles([...products, ...references], async (files) => {
    const productFiles = files.slice(0, products.length);
    const referenceFiles = files.slice(products.length);
    if (provider === "env-override") {
      const generator = resolveToolGenerator(TASK_TOOL[input.task])!;
      const image = await withQa(
        (prompt) => generator({ productImages: productFiles, referenceImages: referenceFiles, prompt }).then((r) => r.imageBuffer),
        flat,
      );
      return { image: await finishOutput(image), mime: "image/jpeg" as const, provider };
    }
    const size = openAiSizeForRatio(input.aspectRatio);
    const image = await withQa((prompt) => editImages(files, prompt, undefined, size ? { size } : undefined), flat);
    return { image: await finishOutput(image), mime: "image/jpeg" as const, provider };
  });
}

/** Runs tasks with at most `limit` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]!, i) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
