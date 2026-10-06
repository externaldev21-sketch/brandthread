/**
 * Brandthread AI Brain — AI Settings policy (pure helpers)
 *
 * How each AI Settings toggle is applied on the client. The server applies
 * the same rules (artifacts/api-server/src/lib/aiSettings.ts) to its stored
 * per-account copy, so these helpers only decide what the UI shows / asks
 * before anything is sent; they never loosen what the server enforces.
 */

import {
  AIActionCard,
  AISettings,
  DEFAULT_AI_SETTINGS,
  SuggestionCategory,
} from './aiTypes';

type DataSourceKey = keyof AISettings['dataSources'];

const DATA_SOURCE_KEYS = Object.keys(DEFAULT_AI_SETTINGS.dataSources) as DataSourceKey[];

const PERMISSION_KEYS = ['enabled', 'suggestionsEnabled', 'sessionMemoryEnabled', 'brandMemoryEnabled'] as const;
const CONFIRM_KEYS = ['confirmSensitiveActions', 'confirmDestructiveActions', 'confirmPublishing', 'confirmSending'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Coerces cached / server JSON into a complete settings object: unknown keys
 * dropped, non-boolean values replaced by the defaults, missing data sources on.
 */
export function normalizeAISettings(raw: unknown): AISettings {
  const src = isRecord(raw) ? raw : {};
  const dsRaw = isRecord(src.dataSources) ? src.dataSources : {};
  const dataSources = { ...DEFAULT_AI_SETTINGS.dataSources };
  for (const k of DATA_SOURCE_KEYS) {
    if (typeof dsRaw[k] === 'boolean') dataSources[k] = dsRaw[k] as boolean;
  }
  const out: AISettings = { ...DEFAULT_AI_SETTINGS, dataSources };
  for (const k of [...PERMISSION_KEYS, ...CONFIRM_KEYS]) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  }
  return out;
}

// ─── Confirm-before-action ────────────────────────────────────────────────────

export type AIConfirmationReason = 'destructive' | 'publishing' | 'sending' | 'sensitive';

const MUTATING_ACTION_TYPES = new Set<string>(['edit', 'apply', 'create_draft', 'duplicate', 'schedule', 'export']);
const PUBLISH_RE = /\b(publish|publishing|go live|goes live|make (?:it )?live|launch)\b/i;
const SEND_RE = /\b(send|sending|email|e-mail|sms|text message|notify|notification|dm)\b/i;

/**
 * Which of the seller's confirm-before-action toggles applies to this card,
 * or null when it can be applied straight away. Most severe rule first.
 * `requiresConfirmation` (stamped by the server from the account's stored
 * settings) counts as a sensitive action, so a confirmation the server asks
 * for is honored even if this device's cache is behind.
 */
export function actionConfirmationReason(
  card: Pick<AIActionCard, 'type' | 'title' | 'description' | 'isDestructive' | 'requiresConfirmation'>,
  settings: AISettings,
): AIConfirmationReason | null {
  const text = `${card.title ?? ''} ${card.description ?? ''}`;
  if (card.isDestructive && settings.confirmDestructiveActions) return 'destructive';
  if ((card.type === 'schedule' || PUBLISH_RE.test(text)) && settings.confirmPublishing) return 'publishing';
  if (SEND_RE.test(text) && settings.confirmSending) return 'sending';
  if (card.requiresConfirmation) return 'sensitive';
  if (MUTATING_ACTION_TYPES.has(card.type) && settings.confirmSensitiveActions) return 'sensitive';
  return null;
}

/** Alert copy for a confirmation step. */
export function confirmationCopy(
  reason: AIConfirmationReason,
  title: string,
): { heading: string; message: string } {
  switch (reason) {
    case 'destructive':
      return { heading: 'Apply action', message: `Are you sure you want to apply "${title}"? This action is irreversible.` };
    case 'publishing':
      return { heading: 'Confirm publishing', message: `"${title}" will publish changes. Apply it?` };
    case 'sending':
      return { heading: 'Confirm sending', message: `"${title}" will send a message. Apply it?` };
    default:
      return { heading: 'Confirm action', message: `"${title}" will change your account. Apply it?` };
  }
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

const SUGGESTION_CATEGORY_SOURCE: Record<SuggestionCategory, DataSourceKey> = {
  inventory: 'inventory',
  orders: 'orders',
  content: 'content',
  marketing: 'marketing',
  store: 'store',
  customers: 'customers',
  production: 'manufacturers',
  analytics: 'analytics',
};

/** False when the assistant or dashboard suggestions are off, or the category's data source is off. */
export function suggestionCategoryAllowed(category: string, settings: AISettings): boolean {
  if (!settings.enabled || !settings.suggestionsEnabled) return false;
  const source = SUGGESTION_CATEGORY_SOURCE[category as SuggestionCategory];
  return source ? settings.dataSources[source] : true;
}

// ─── Disabled assistant ───────────────────────────────────────────────────────

export const AI_DISABLED_MESSAGE = 'Brandthread AI is turned off in AI Settings.';

/** Error thrown by the send functions when the assistant is turned off. */
export function aiDisabledError(): Error {
  return Object.assign(new Error(AI_DISABLED_MESSAGE), { name: 'AIDisabledError' });
}

export function isAIDisabledError(err: unknown): boolean {
  return (err as Error | null)?.name === 'AIDisabledError';
}
