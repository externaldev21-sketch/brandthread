/**
 * Brandthread AI Tools — seller-facing error copy (shared)
 *
 * The design services throw `ApiError`s whose `message` is the raw
 * "API <status>: <server text>" string (lib/networkNotice.ts). Shown as-is in
 * a result tile or chat bubble that reads as a dev error. This maps a thrown
 * error to plain copy, and routes an out-of-credits refusal (402
 * insufficient_credits) to the AI credits screen the same way lib/api.ts does.
 */
import { AI_CREDITS_ALERT_COPY, classifyAiCreditsError, surfaceAiCreditsError } from '@/lib/aiCreditsError';

/** The API's 503 when no image model key is set yet (api-server lib/aiImageEngine). */
export const AI_IMAGE_ENGINE_NOT_CONFIGURED = 'ai_image_engine_not_configured';
export const AI_IMAGE_ENGINE_OFF_COPY = "AI photos aren't switched on yet. Nothing was charged. Please check back soon.";

function bodyCode(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}

export function aiToolErrorMessage(err: unknown, fallback: string): string {
  const e = (err ?? null) as { status?: unknown; body?: unknown; message?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : null;
  if (status !== null) {
    const kind = classifyAiCreditsError(status, typeof e?.body === 'string' ? e.body : undefined);
    if (kind === 'insufficient_credits') {
      surfaceAiCreditsError(kind);
      return 'Not enough AI credits. Add credits to keep generating.';
    }
    if (kind) return AI_CREDITS_ALERT_COPY[kind].message;
    if (status === 503 && bodyCode(e?.body) === AI_IMAGE_ENGINE_NOT_CONFIGURED) return AI_IMAGE_ENGINE_OFF_COPY;
    if (status === 401) return 'Sign in to a seller account to use AI tools.';
    if (status === 429) return 'Too many requests. Please wait a minute and try again.';
    if (status >= 500) return 'The service is temporarily unavailable. Please try again shortly.';
  }
  const raw = typeof e?.message === 'string' ? e.message.replace(/^API \d{3}:\s*/, '').trim() : '';
  if (!raw || raw.startsWith('{') || raw.startsWith('<')) return fallback;
  if (/network request failed|failed to fetch|fetch failed|load failed/i.test(raw)) {
    return 'Network error. Check your connection and try again.';
  }
  return raw;
}

/** A failed result slot's error copy, and whether a Retry button can help. */
export function aiToolFailure(message: string): { error: string; retryable: boolean } {
  return { error: message, retryable: message !== AI_IMAGE_ENGINE_OFF_COPY };
}
