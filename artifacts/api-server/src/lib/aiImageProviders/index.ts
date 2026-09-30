export * from "./types";
export * from "./config";
export * from "./pipelines";
export { openaiProvider } from "./providers/openai";
export { fashnDirectProvider } from "./providers/fashnDirect";
export {
  falFashnProvider,
  falKlingProvider,
  falNanoBananaProvider,
  falQwenProvider,
} from "./providers/fal";

import type { ImageProvider, ProviderId } from "./types";
import { openaiProvider } from "./providers/openai";
import { fashnDirectProvider } from "./providers/fashnDirect";
import {
  falFashnProvider,
  falKlingProvider,
  falNanoBananaProvider,
  falQwenProvider,
} from "./providers/fal";

export const ALL_PROVIDERS: Record<ProviderId, ImageProvider> = {
  openai: openaiProvider,
  "fashn-direct": fashnDirectProvider,
  "fal-fashn": falFashnProvider,
  "fal-kling": falKlingProvider,
  "fal-nano-banana": falNanoBananaProvider,
  "fal-qwen": falQwenProvider,
};

export function getProvider(id: ProviderId): ImageProvider {
  return ALL_PROVIDERS[id];
}

/** Every provider whose required env var(s) are actually present right now. */
export function getConfiguredProviders(): ImageProvider[] {
  return Object.values(ALL_PROVIDERS).filter((p) => p.isConfigured());
}
