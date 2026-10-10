/**
 * Estimated OpenAI list prices, in US dollars per 1M tokens. Because
 * $/1M tokens equals micro-dollars per token, cost_micros is simply
 * tokens × price. These are estimates for the admin spend view, not billing:
 * update the table when provider pricing changes. A model that is not listed
 * records cost 0 with priced = false so the dashboard can flag it instead of
 * silently under-reporting.
 */
export interface ModelPrice { input: number; output: number }

export const AI_MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  // Image models: `input` is the text-input rate; `output` the image-output token rate.
  "gpt-image-1": { input: 5, output: 40 },
  "gpt-image-1.5": { input: 5, output: 32 },
  "gpt-image-2": { input: 5, output: 30 },
};

/**
 * Per-image list prices for the OpenAI image models in the shared client's
 * model chain (lib/integrations-openai-ai-server/src/image/model.ts), used by
 * the credit cost table (lib/aiCredits/costTable.ts) to price every tool.
 * `output` is one generated 1024x1024 image at each quality; input images and
 * prompt text are billed per token on top.
 */
export interface ImageModelPrice {
  output: { low: number; medium: number; high: number };
  imageInputPerMTok: number;
  textInputPerMTok: number;
}

export const AI_IMAGE_MODEL_PRICES: Record<string, ImageModelPrice> = {
  "gpt-image-2":   { output: { low: 0.006, medium: 0.053, high: 0.211 }, imageInputPerMTok: 8,  textInputPerMTok: 5 },
  "gpt-image-1.5": { output: { low: 0.009, medium: 0.034, high: 0.133 }, imageInputPerMTok: 8,  textInputPerMTok: 5 },
  "gpt-image-1":   { output: { low: 0.011, medium: 0.042, high: 0.167 }, imageInputPerMTok: 10, textInputPerMTok: 5 },
};

function lookup(model: string): ModelPrice | null {
  if (AI_MODEL_PRICES[model]) return AI_MODEL_PRICES[model]!;
  // Dated snapshots such as "gpt-4.1-2025-04-14": longest known prefix wins.
  const match = Object.keys(AI_MODEL_PRICES)
    .filter((key) => model.startsWith(`${key}-`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? AI_MODEL_PRICES[match]! : null;
}

export function priceAiUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costMicros: number; priced: boolean } {
  const price = lookup(model);
  if (!price) return { costMicros: 0, priced: false };
  const micros = Math.max(0, inputTokens) * price.input + Math.max(0, outputTokens) * price.output;
  return { costMicros: Math.round(micros), priced: true };
}
