/**
 * Google Gemini image generation ("Nano Banana" family) over the REST API.
 *
 * Key, in order: GEMINI_API_KEY, GOOGLE_API_KEY, or Replit's Gemini AI
 * integration (AI_INTEGRATIONS_GEMINI_API_KEY + AI_INTEGRATIONS_GEMINI_BASE_URL).
 * Model: GEMINI_IMAGE_MODEL (default gemini-3-pro-image-preview, a.k.a. Nano
 * Banana Pro: multi-reference composition, up to 14 input images, 2K output),
 * then each of GEMINI_IMAGE_MODEL_FALLBACKS when the provider reports a model
 * as unknown.
 */
import type { AspectRatio } from "./prompts";

type Env = Record<string, string | undefined>;

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";
export const DEFAULT_GEMINI_IMAGE_FALLBACKS = ["gemini-2.5-flash-image"];
const PUBLIC_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 150_000;

export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  models: string[];
}

export function resolveGeminiConfig(env: Env = process.env): GeminiConfig | null {
  const integrationKey = env.AI_INTEGRATIONS_GEMINI_API_KEY?.trim();
  const integrationBase = env.AI_INTEGRATIONS_GEMINI_BASE_URL?.trim();
  const directKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  let apiKey: string | undefined;
  let baseUrl = PUBLIC_BASE;
  if (directKey) {
    apiKey = directKey;
  } else if (integrationKey && integrationBase) {
    apiKey = integrationKey;
    baseUrl = integrationBase;
  }
  if (!apiKey) return null;
  const primary = env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
  const fallbacks = env.GEMINI_IMAGE_MODEL_FALLBACKS === undefined
    ? DEFAULT_GEMINI_IMAGE_FALLBACKS
    : env.GEMINI_IMAGE_MODEL_FALLBACKS.split(",").map((m) => m.trim()).filter(Boolean);
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), models: [...new Set([primary, ...fallbacks])] };
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export class GeminiImageError extends Error {
  constructor(
    message: string,
    readonly kind: "blocked" | "no_image" | "model_unavailable" | "http",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiImageError";
  }
}

/** 2K output is a Pro-tier option; flash image models reject imageSize. */
function supportsImageSize(model: string): boolean {
  return /pro/i.test(model);
}

async function callModel(cfg: GeminiConfig, model: string, parts: GeminiPart[], aspectRatio: AspectRatio | undefined, signal?: AbortSignal) {
  const imageConfig: Record<string, string> = {};
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (supportsImageSize(model)) imageConfig.imageSize = "2K";
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const resp = await fetch(`${cfg.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
      },
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await resp.text();
  if (!resp.ok) {
    const unavailable = (resp.status === 404 || resp.status === 400) && /model|not found|not supported/i.test(text);
    throw new GeminiImageError(`Gemini ${model} returned ${resp.status}`, unavailable ? "model_unavailable" : "http", resp.status);
  }
  const body = JSON.parse(text) as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
  };
  if (body.promptFeedback?.blockReason) throw new GeminiImageError(`Blocked: ${body.promptFeedback.blockReason}`, "blocked");
  const candidate = body.candidates?.[0];
  const image = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!image) {
    const reason = candidate?.finishReason ?? "none";
    throw new GeminiImageError(`Gemini returned no image (finishReason ${reason})`, /SAFETY|PROHIBITED|BLOCK/i.test(reason) ? "blocked" : "no_image");
  }
  return Buffer.from(image, "base64");
}

export async function generateWithGemini(
  cfg: GeminiConfig,
  parts: GeminiPart[],
  options: { aspectRatio?: AspectRatio; signal?: AbortSignal } = {},
): Promise<{ image: Buffer; model: string }> {
  let lastError: unknown;
  for (const model of cfg.models) {
    try {
      return { image: await callModel(cfg, model, parts, options.aspectRatio, options.signal), model };
    } catch (err) {
      lastError = err;
      if (!(err instanceof GeminiImageError) || err.kind !== "model_unavailable") throw err;
    }
  }
  throw lastError;
}
