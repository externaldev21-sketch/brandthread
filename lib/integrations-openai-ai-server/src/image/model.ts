/**
 * Which OpenAI image model every image call uses, from env, with an ordered
 * fallback list for when the provider reports a model as unknown, retired or
 * deprecated. gpt-image-1 is shut down on Oct 23, 2026, so the model is never
 * hard-coded in the client again.
 *
 *   OPENAI_IMAGE_MODEL            primary model (default: gpt-image-2, the GA successor)
 *   OPENAI_IMAGE_MODEL_FALLBACKS  comma-separated, tried in order (default: gpt-image-1.5,gpt-image-1)
 *
 * Any model added here must also be priced in the API server's aiPricing.ts
 * (AI_IMAGE_MODEL_PRICES): the credit catalogue prices every tool against the
 * most expensive model in this chain.
 */
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_OPENAI_IMAGE_MODEL_FALLBACKS = ["gpt-image-1.5", "gpt-image-1"] as const;

/** Primary model first, then the fallbacks; trimmed, de-duplicated, never empty. */
export function getImageModelChain(env: Record<string, string | undefined> = process.env): string[] {
  const primary = env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
  const rawFallbacks = env.OPENAI_IMAGE_MODEL_FALLBACKS;
  const fallbacks = rawFallbacks === undefined
    ? [...DEFAULT_OPENAI_IMAGE_MODEL_FALLBACKS]
    : rawFallbacks.split(",").map((m) => m.trim()).filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

/**
 * True only when the provider says the model itself is unavailable (unknown,
 * removed, retired or deprecated). Content-policy, quota, rate-limit and
 * network errors are not model problems and must not burn a fallback call.
 */
export function isModelUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: unknown; error?: { code?: unknown; message?: unknown }; message?: unknown };
  const code = String(e.code ?? e.error?.code ?? "").toLowerCase();
  if (code === "model_not_found" || code === "model_deprecated" || code === "model_retired" || code === "invalid_model") {
    return true;
  }
  if (e.status !== 400 && e.status !== 404 && e.status !== 410) return false;
  const message = String(e.message ?? e.error?.message ?? "").toLowerCase();
  if (!message.includes("model")) return false;
  return /does not exist|not found|deprecated|retired|no longer (available|supported)|has been shut ?down|invalid model|unknown model/.test(message);
}

/**
 * Runs `call` with each model in the chain until one is accepted. Only a
 * model-unavailable error moves on to the next model; any other error is
 * thrown as is. If every model is unavailable, the last error is thrown.
 */
export async function withImageModelFallback<T>(
  call: (model: string) => Promise<T>,
  options: { models?: string[]; onFallback?: (from: string, to: string, err: unknown) => void } = {},
): Promise<T> {
  const models = options.models ?? getImageModelChain();
  let lastError: unknown;
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i]!;
    try {
      return await call(model);
    } catch (err) {
      if (!isModelUnavailableError(err)) throw err;
      lastError = err;
      const next = models[i + 1];
      if (next) options.onFallback?.(model, next, err);
    }
  }
  throw lastError;
}
