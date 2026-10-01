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
  "gpt-image-1": { input: 5, output: 40 },
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
