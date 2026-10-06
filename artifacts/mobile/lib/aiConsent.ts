/**
 * One-time permission before Brandthread AI sends what someone uploads or
 * types to an AI provider (App Store 5.1.2(i), QA-0043).
 *
 * The server is the source of truth: every AI endpoint answers
 * 403 { code: 'ai_consent_required' } until the person allows it. The API
 * layer (lib/api.ts) and the AI chat stream (services/aiService.ts) catch
 * that, ask through the sheet registered by <AiConsentSheet />, and retry the
 * request once if the person allows. Settings > AI data sharing withdraws it.
 */
export const AI_CONSENT_REQUIRED = 'ai_consent_required';

/** Who receives the content (matches the server's AI_PROVIDERS). */
export const AI_PROVIDER_NAMES = ['OpenAI', 'fal.ai', 'FASHN'] as const;

export class AiConsentRequiredError extends Error {
  readonly code = AI_CONSENT_REQUIRED;
  constructor(message = 'Allow AI data sharing to use Brandthread AI. You can change this in Settings.') {
    super(message);
    this.name = 'AiConsentRequiredError';
  }
}

/** True for the server's consent refusal, whichever layer surfaced it. */
export function isAiConsentRequired(error: unknown): boolean {
  if (error instanceof AiConsentRequiredError) return true;
  const e = error as { status?: unknown; body?: unknown; message?: unknown } | null;
  if (!e || e.status !== 403) return false;
  const body = typeof e.body === 'string' ? e.body : typeof e.message === 'string' ? e.message : '';
  return isAiConsentRequiredBody(403, body);
}

export function isAiConsentRequiredBody(status: number, body: string): boolean {
  if (status !== 403 || !body) return false;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; error?: { code?: unknown } };
    return parsed?.code === AI_CONSENT_REQUIRED || parsed?.error?.code === AI_CONSENT_REQUIRED;
  } catch {
    return false;
  }
}

type Prompter = () => Promise<boolean>;
let prompter: Prompter | null = null;
let pending: Promise<boolean> | null = null;

/** The consent sheet registers itself here; returns an unregister function. */
export function setAiConsentPrompter(next: Prompter): () => void {
  prompter = next;
  return () => { if (prompter === next) prompter = null; };
}

/** Ask once, even if several AI calls are refused at the same moment. */
export function requestAiConsent(): Promise<boolean> {
  if (!prompter) return Promise.resolve(false);
  if (!pending) pending = prompter().catch(() => false).finally(() => { pending = null; });
  return pending;
}

/**
 * Runs an AI request; if the server needs consent, asks for it and retries
 * exactly once. If the person declines, the original refusal is rethrown so
 * the screen shows its normal error.
 */
export async function withAiConsent<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isAiConsentRequired(error)) throw error;
    if (!(await requestAiConsent())) throw error;
    return run();
  }
}
