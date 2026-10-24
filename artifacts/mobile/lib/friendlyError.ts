/**
 * Turns an API / runtime error into short copy a person can act on.
 *
 * Screens used to show `e.message` straight from the API client, so people saw
 * raw strings like "API 500: Internal Server Error" or a JSON body. This keeps
 * the specific, human validation messages the server sends for 4xx responses
 * ("Title is required", "That code is already in use") and replaces
 * everything technical with the caller's own fallback or a short status line.
 */
import { ApiError } from '@/lib/networkNotice';

const API_PREFIX = /^API (\d{3}):\s*([\s\S]*)$/;
const NETWORK_FAILURE = /network request failed|failed to fetch|network error|internet connection|offline|load failed/i;
// Messages that are clearly developer-facing rather than written for people.
const TECHNICAL = /[{}<>]|\b(undefined|NaN|TypeError|ReferenceError|SyntaxError|JSON|Unexpected token|ECONN\w*|ETIMEDOUT|status code)\b/;
// A bare HTTP reason phrase ("Internal Server Error") or an error code
// ("ROLE_REQUIRED") says nothing a person can act on.
const BARE_STATUS = /^(internal server error|bad request|unprocessable entity|not found|forbidden|unauthorized|service unavailable|bad gateway|gateway timeout|conflict|too many requests|error)\.?$/i;
const ERROR_CODE = /^[A-Z0-9_.:-]+$/;
const MAX_HUMAN_LENGTH = 160;

export const FRIENDLY_NETWORK_MESSAGE = 'Check your connection and try again.';
export const FRIENDLY_RATE_LIMIT_MESSAGE = 'Too many tries. Wait a moment and try again.';
export const FRIENDLY_TIMEOUT_MESSAGE = 'That took too long. Try again.';
export const FRIENDLY_SIGNED_OUT_MESSAGE = 'Your session expired. Sign in again and retry.';
export const FRIENDLY_FORBIDDEN_MESSAGE = "You don't have access to do that.";

function parse(err: unknown): { status: number | null; message: string } {
  if (err instanceof ApiError) {
    const match = err.message.match(API_PREFIX);
    return { status: err.status, message: (match ? match[2] : err.message).trim() };
  }
  const raw = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : typeof (err as { message?: unknown } | null)?.message === 'string'
        ? (err as { message: string }).message
        : '';
  const match = raw.match(API_PREFIX);
  if (match) return { status: Number(match[1]), message: match[2].trim() };
  return { status: null, message: raw.trim() };
}

function isHuman(message: string): boolean {
  return message.length > 0
    && message.length <= MAX_HUMAN_LENGTH
    && !TECHNICAL.test(message)
    && !BARE_STATUS.test(message)
    && !ERROR_CODE.test(message);
}

/**
 * @param err      Whatever the API call threw.
 * @param fallback Screen-specific copy for anything not worth showing as-is,
 *                 e.g. "Could not schedule the live. Try again."
 */
export function friendlyError(err: unknown, fallback: string): string {
  const { status, message } = parse(err);
  if (status === null) {
    if (NETWORK_FAILURE.test(message)) return FRIENDLY_NETWORK_MESSAGE;
    return isHuman(message) ? message : fallback;
  }
  if (status === 401) return FRIENDLY_SIGNED_OUT_MESSAGE;
  if (status === 403) return isHuman(message) ? message : FRIENDLY_FORBIDDEN_MESSAGE;
  if (status === 408 || status === 504) return FRIENDLY_TIMEOUT_MESSAGE;
  if (status === 429) return FRIENDLY_RATE_LIMIT_MESSAGE;
  // Other 4xx: the server's validation copy is the most useful thing to show.
  if (status >= 400 && status < 500) return isHuman(message) ? message : fallback;
  return fallback;
}
