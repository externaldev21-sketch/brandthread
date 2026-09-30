/**
 * Pure logic for the TikTok-style "one field, email or phone" sign-in step —
 * no RN/Clerk imports, so it's unit-tested directly.
 */

export type IdentifierKind = 'email' | 'phone' | 'invalid';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Loose E.164-ish check: optional leading +, 7-15 digits total, spaces/
// dashes/parens allowed as visual separators only. Real validation is
// Clerk's job — this just decides which strategy to try.
const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;
const PHONE_DIGIT_COUNT_RE = /\d/g;

export function detectIdentifierKind(raw: string): IdentifierKind {
  const trimmed = raw.trim();
  if (!trimmed) return 'invalid';
  if (trimmed.includes('@')) return EMAIL_RE.test(trimmed) ? 'email' : 'invalid';
  if (PHONE_RE.test(trimmed)) {
    const digitCount = (trimmed.match(PHONE_DIGIT_COUNT_RE) ?? []).length;
    return digitCount >= 7 ? 'phone' : 'invalid';
  }
  return 'invalid';
}

/** Normalizes a phone-shaped identifier toward E.164 (strips visual separators, keeps a leading +). */
export function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Best-effort detection that a Clerk error means "phone sign-in isn't
 * enabled for this instance" rather than a real per-attempt failure (bad
 * number, rate limit, network). Clerk is external and gives this app no
 * direct capability-check API, so this is a heuristic over the error
 * shape — verify against the real Clerk instance once phone is configured.
 */
export function isPhoneStrategyUnsupportedError(err: { code?: string; message?: string; longMessage?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = (err.code ?? '').toLowerCase();
  if (code === 'strategy_for_user_invalid' || code === 'form_identifier_not_allowed') return true;
  const text = `${err.message ?? ''} ${err.longMessage ?? ''}`.toLowerCase();
  return text.includes('phone') && (text.includes('not enabled') || text.includes('disabled') || text.includes('not supported') || text.includes('not available'));
}
