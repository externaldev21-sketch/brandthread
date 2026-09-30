/**
 * Per-tool provider/pipeline selection, entirely from env vars.
 *
 * Mockup to Model and AI Photoshoot may land on different providers — the
 * research docs flag Photoshoot's exotic-reference case as strictly harder
 * than Mockup to Model's studio-garment case, so nothing here assumes they
 * converge. Add a new `AiTool` and its config resolves the same way, no
 * code change beyond that.
 *
 * IMPORTANT: nothing in this module is wired into `routes/photography.ts`
 * yet. Defaults below intentionally mirror today's production behavior
 * (openai / single-stage) so importing this module changes nothing until a
 * route explicitly opts in after a real benchmark picks a winner.
 */
import type { PipelineId, ProviderId } from "./types";

export type AiTool = "mockup-to-model" | "ai-photoshoot";

export interface ToolProviderConfig {
  pipeline: PipelineId;
  /** Single-stage: the one provider used. Two-stage: the stage-2 (garment-fidelity) provider. */
  provider: ProviderId;
  /** Two-stage only: the stage-1 (creative-scene) provider. */
  sceneProvider?: ProviderId;
}

const TOOL_ENV_PREFIX: Record<AiTool, string> = {
  "mockup-to-model": "AI_IMAGE_MOCKUP_TO_MODEL",
  "ai-photoshoot": "AI_IMAGE_AI_PHOTOSHOOT",
};

const DEFAULT_PROVIDER: ProviderId = "openai";
const DEFAULT_PIPELINE: PipelineId = "single-stage";

function readEnvProvider(name: string): ProviderId | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const valid: ProviderId[] = [
    "openai",
    "fashn-direct",
    "fal-fashn",
    "fal-kling",
    "fal-nano-banana",
    "fal-qwen",
  ];
  return (valid as string[]).includes(value) ? (value as ProviderId) : undefined;
}

function readEnvPipeline(name: string): PipelineId | undefined {
  const value = process.env[name];
  if (value === "single-stage" || value === "two-stage") return value;
  return undefined;
}

/**
 * Resolves which provider(s)/pipeline a given AI tool should use.
 *
 * Env vars (all optional, all fall back to today's production behavior):
 *   AI_IMAGE_MOCKUP_TO_MODEL_PIPELINE=single-stage|two-stage
 *   AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER=openai|fashn-direct|fal-fashn|fal-kling|fal-nano-banana|fal-qwen
 *   AI_IMAGE_MOCKUP_TO_MODEL_SCENE_PROVIDER=<same set, two-stage stage 1 only>
 *   AI_IMAGE_AI_PHOTOSHOOT_PIPELINE / _PROVIDER / _SCENE_PROVIDER — same shape, other tool.
 */
export function getToolProviderConfig(tool: AiTool): ToolProviderConfig {
  const prefix = TOOL_ENV_PREFIX[tool];
  const pipeline = readEnvPipeline(`${prefix}_PIPELINE`) ?? DEFAULT_PIPELINE;
  const provider = readEnvProvider(`${prefix}_PROVIDER`) ?? DEFAULT_PROVIDER;
  const sceneProvider = readEnvProvider(`${prefix}_SCENE_PROVIDER`);
  return { pipeline, provider, sceneProvider };
}

/** The OpenAI image-edit model to use going forward. gpt-image-1 is retired Oct 23, 2026;
 *  OpenAI's own successor line is gpt-image-2.5 (two variants: "flare" = faster, "sunburst" =
 *  more detailed). Configurable so this doesn't need another code change if OpenAI renames
 *  the line again before we cut over the real production route. */
export function getOpenAiImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
}

export function getFashnApiKey(): string | undefined {
  return process.env.FASHN_API_KEY || undefined;
}

export function getFalApiKey(): string | undefined {
  return process.env.FAL_KEY || undefined;
}

/** fal.ai model slugs are configurable, not hardcoded — verify these against fal.ai's
 *  current /explore listing once FAL_KEY exists, since aggregator slugs do move. The
 *  defaults below are the best candidates found during research (see
 *  docs/polish/ai-provider-benchmark/README.md for sources); treat them as a starting
 *  point to confirm, not a guarantee. */
export function getFalModelSlug(provider: "fal-fashn" | "fal-kling" | "fal-nano-banana" | "fal-qwen"): string {
  const envKey = `FAL_MODEL_SLUG_${provider.toUpperCase().replace(/-/g, "_")}`;
  const override = process.env[envKey];
  if (override) return override;
  switch (provider) {
    case "fal-fashn":
      return "fal-ai/fashn/tryon/v1.6";
    case "fal-kling":
      return "fal-ai/kling/v1-5/kolors-virtual-try-on";
    case "fal-nano-banana":
      return "fal-ai/nano-banana-pro/edit";
    case "fal-qwen":
      return "fal-ai/qwen-image-edit";
  }
}
