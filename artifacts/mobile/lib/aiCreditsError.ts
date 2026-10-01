/**
 * Recognises the AI credit gate's refusals (server: lib/aiCredits/gate.ts):
 *   402 insufficient_credits  -> send the user to the AI credits screen
 *   429 user_daily_cap        -> standard alert
 *   503 global_daily_cap      -> standard alert
 * The classifier is pure; `surfaceAiCreditsError` does the navigation/alert
 * and is called once from the central request helper in lib/api.ts.
 */

export type AiCreditsErrorKind = 'insufficient_credits' | 'user_daily_cap' | 'global_daily_cap';

const STATUS_FOR: Record<AiCreditsErrorKind, number> = {
  insufficient_credits: 402,
  user_daily_cap: 429,
  global_daily_cap: 503,
};

export function classifyAiCreditsError(status: number, body: string | undefined): AiCreditsErrorKind | null {
  if (status !== 402 && status !== 429 && status !== 503) return null;
  let code: unknown;
  try {
    const parsed = JSON.parse(body ?? '');
    code = parsed?.code ?? parsed?.error?.code;
  } catch {
    return null;
  }
  if (typeof code !== 'string') return null;
  const kind = code as AiCreditsErrorKind;
  return STATUS_FOR[kind] === status ? kind : null;
}

export const AI_CREDITS_ALERT_COPY: Record<Exclude<AiCreditsErrorKind, 'insufficient_credits'>, { title: string; message: string }> = {
  user_daily_cap: { title: 'Daily AI limit reached', message: "You have reached today's AI limit. It resets tomorrow." },
  global_daily_cap: { title: 'AI is at capacity', message: 'AI tools are at capacity right now. Please try again later.' },
};

let lastSurfacedAt = 0;

/** Navigates or alerts, at most once every few seconds. Never throws. */
export function surfaceAiCreditsError(kind: AiCreditsErrorKind, now = Date.now()): void {
  if (now - lastSurfacedAt < 3000) return;
  lastSurfacedAt = now;
  try {
    if (kind === 'insufficient_credits') {
      const { router } = require('expo-router') as typeof import('expo-router');
      router.push('/ai-credits' as never);
      return;
    }
    const { Alert } = require('react-native') as typeof import('react-native');
    const copy = AI_CREDITS_ALERT_COPY[kind];
    Alert.alert(copy.title, copy.message);
  } catch {
    // Surfacing is best effort; the original error still reaches the caller.
  }
}
