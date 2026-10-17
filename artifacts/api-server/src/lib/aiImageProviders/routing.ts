/**
 * Route-facing selection for the AI image-provider abstraction.
 *
 * `resolveToolGenerator(tool)` returns:
 *   - `null` when the tool is on today's default (openai, single-stage) — the
 *     route keeps calling its existing OpenAI path, unchanged;
 *   - a generator bound to the env-selected provider/pipeline otherwise
 *     (e.g. AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER=fal-fashn routes Mockup to
 *     Model through fal.ai using FAL_KEY).
 *
 * If a non-default provider is selected but its key is missing, it throws
 * `AiProviderNotConfiguredError` with an actionable message naming the env
 * var to set, so the route can answer with a clear 503 instead of a generic
 * provider failure. Keys are only ever read from env (see config.ts).
 */
import { getToolProviderConfig, type AiTool } from "./config";
import { getProvider } from "./index";
import { runSingleStage, runTwoStage } from "./pipelines";
import type { GenerationInput, GenerationResult, ImageProvider, ProviderId } from "./types";

const TOOL_LABEL: Record<AiTool, string> = {
  "mockup-to-model": "Mockup to Model",
  "ai-photoshoot": "AI Photoshoot",
};

const TOOL_PROVIDER_ENV: Record<AiTool, string> = {
  "mockup-to-model": "AI_IMAGE_MOCKUP_TO_MODEL_PROVIDER",
  "ai-photoshoot": "AI_IMAGE_AI_PHOTOSHOOT_PROVIDER",
};

/** The env var(s) a provider needs before it can be called. */
export function requiredEnvFor(id: ProviderId): string {
  if (id === "fashn-direct") return "FASHN_API_KEY";
  if (id === "openai") return "AI_INTEGRATIONS_OPENAI_API_KEY and AI_INTEGRATIONS_OPENAI_BASE_URL";
  return "FAL_KEY";
}

export class AiProviderNotConfiguredError extends Error {
  readonly code = "ai_provider_not_configured";
  constructor(
    readonly tool: AiTool,
    readonly providerId: ProviderId,
    readonly envVar: string,
  ) {
    super(
      `${TOOL_LABEL[tool]} is set to use the "${providerId}" image provider, but ${envVar} isn't set. ` +
        `Set ${envVar} on the API server, or unset ${TOOL_PROVIDER_ENV[tool]} to use the default provider.`,
    );
    this.name = "AiProviderNotConfiguredError";
  }
}

export type ToolGenerator = (input: GenerationInput) => Promise<GenerationResult>;

function requireConfigured(tool: AiTool, provider: ImageProvider): ImageProvider {
  if (!provider.isConfigured()) {
    throw new AiProviderNotConfiguredError(tool, provider.id, requiredEnvFor(provider.id));
  }
  return provider;
}

export function resolveToolGenerator(tool: AiTool): ToolGenerator | null {
  const config = getToolProviderConfig(tool);
  if (config.pipeline === "single-stage" && config.provider === "openai") return null;

  const garment = requireConfigured(tool, getProvider(config.provider));
  if (config.pipeline === "single-stage") {
    return (input) => runSingleStage(garment, input);
  }
  const scene = requireConfigured(tool, getProvider(config.sceneProvider ?? "openai"));
  return (input) => runTwoStage(scene, garment, input);
}
