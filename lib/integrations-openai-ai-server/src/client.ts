import type OpenAI from "openai";

import { lazyOpenAiClient } from "./config";

export {
  DEFAULT_OPENAI_BASE_URL,
  OpenAiNotConfiguredError,
  createOpenAiClient,
  isOpenAiConfigured,
  lazyOpenAiClient,
  resolveOpenAiConfig,
  type OpenAiConfig,
  type OpenAiConfigSource,
} from "./config";

/**
 * Shared, metered client. Created on first use (see config.ts), so importing
 * this package never throws when the AI env is missing; a call without
 * credentials throws OpenAiNotConfiguredError.
 */
export const openai: OpenAI = lazyOpenAiClient((client) => {
  meter(client.chat.completions, "create", "chat");
  meter(client.images, "generate", "image");
  meter(client.images, "edit", "image_edit");
});

// ─── Usage reporting ─────────────────────────────────────────────────────────
// Optional hook so the host app can meter AI spend (per user, per feature)
// without every call site knowing about it. The API server registers a
// reporter at startup; with none registered this is a no-op. Reporting is
// best-effort and never affects the AI call's result.

export interface AiUsageReport {
  feature: "chat" | "image" | "image_edit";
  model: string;
  inputTokens: number;
  outputTokens: number;
}

let usageReporter: ((report: AiUsageReport) => void) | null = null;

export function setAiUsageReporter(reporter: ((report: AiUsageReport) => void) | null): void {
  usageReporter = reporter;
}

function report(feature: AiUsageReport["feature"], model: unknown, usage: any): void {
  if (!usageReporter || !usage) return;
  try {
    usageReporter({
      feature,
      model: typeof model === "string" && model ? model : "unknown",
      inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
      outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    });
  } catch {
    /* metering must never break an AI call */
  }
}

function meter<T extends object>(
  target: T,
  method: keyof T & string,
  feature: AiUsageReport["feature"],
): void {
  const original = (target as any)[method] as (...args: any[]) => any;
  (target as any)[method] = function (this: unknown, ...args: any[]) {
    const result = original.apply(target, args);
    const params = args[0] as { model?: string; stream?: boolean } | undefined;
    // Streaming responses carry no usage object unless requested; skip them.
    if (params?.stream || !result || typeof result.then !== "function") return result;
    // Return the original promise-like (OpenAI's APIPromise exposes
    // .withResponse() etc.); observe it on the side.
    result.then((value: any) => report(feature, value?.model ?? params?.model, value?.usage)).catch(() => {});
    return result;
  };
}
