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
  if (!e || (e.status !== 403 && e.status !== 428)) return false;
  const body = typeof e.body === 'string' ? e.body : typeof e.message === 'string' ? e.message : '';
  return isAiConsentRequiredBody(403, body);
}

export function isAiConsentRequiredBody(status: number, body: string): boolean {
  if ((status !== 403 && status !== 428) || !body) return false;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; error?: { code?: unknown } };
    return [AI_CONSENT_REQUIRED, "AI_CONSENT_REQUIRED"].includes(String(parsed?.code ?? parsed?.error?.code));
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

// Compatibility for older consent callers; authorization is always checked server-side.
/** Sheet copy, kept here so it is reviewable and testable in one place. */
export const AI_CONSENT_COPY = {
  title: 'Allow Brandthread Agent to use OpenAI?',
  lead: 'Brandthread Agent replies are written by OpenAI. To reply, your messages and the recent history of this conversation are sent to OpenAI.',
  detail: 'They are used only to generate replies. Your payment details, Thread Cash and other conversations are not sent.',
  privacyLink: 'Privacy policy',
  allow: 'Allow',
  notNow: 'Not now',
  error: 'Could not save your choice. Check your connection and try again.',
} as const;

export function isAiConsentRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; code?: unknown };
  return e.code === 'AI_CONSENT_REQUIRED' || e.code === AI_CONSENT_REQUIRED || e.status === 428;
}

// Per-session cache: once allowed (or confirmed by the server) the sheet is
// never shown again this session. Keyed by account so a switch re-checks.
let consentedFor: string | null = null;

export function hasCachedAiConsent(accountKey: string): boolean {
  return consentedFor === accountKey;
}

export function cacheAiConsent(accountKey: string): void {
  consentedFor = accountKey;
}

export function clearCachedAiConsent(): void {
  consentedFor = null;
}
