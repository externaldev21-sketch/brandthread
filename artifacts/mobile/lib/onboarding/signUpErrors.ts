/**
 * Decides what a failed `signUp.create` means on the create-account path.
 *
 * The "this email already has an account" screen is only for an email that
 * really is taken. A stale session on the device, a taken username or any
 * other identifier must never read as "your email already exists".
 */

export type SignUpErrorKind =
  /** The email the person typed belongs to an existing account. */
  | { kind: 'email-exists' }
  /** Another session on this device blocks creating a new account. */
  | { kind: 'stale-session' }
  /** Anything else: show it as a normal field error. */
  | { kind: 'other' };

const STALE_SESSION_CODES = new Set(['session_exists', 'identifier_already_signed_in']);

function firstError(err: unknown): { code?: unknown; meta?: { paramName?: unknown } } | null {
  if (!err || typeof err !== 'object') return null;
  const list = (err as { errors?: unknown }).errors;
  const inner = Array.isArray(list) && list.length > 0 ? list[0] : err;
  return inner && typeof inner === 'object' ? inner as { code?: unknown; meta?: { paramName?: unknown } } : null;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * @param submittedEmail the email sent with this `signUp.create` call
 * @param currentEmail   what is in the email field now (the person may have
 *                       edited it while the request was in flight)
 */
export function classifySignUpCreateError(
  err: unknown,
  submittedEmail: string,
  currentEmail: string,
): SignUpErrorKind {
  const inner = firstError(err);
  const code = String(inner?.code ?? '').toLowerCase();
  if (STALE_SESSION_CODES.has(code)) return { kind: 'stale-session' };
  if (code === 'form_identifier_exists') {
    const param = String(inner?.meta?.paramName ?? '').toLowerCase();
    const sameEmail = normalizeEmail(submittedEmail) !== ''
      && normalizeEmail(submittedEmail) === normalizeEmail(currentEmail);
    if (param === 'email_address' && sameEmail) return { kind: 'email-exists' };
  }
  return { kind: 'other' };
}

/** Field error for a taken identifier that isn't the email (e.g. username). */
export function identifierTakenMessage(err: unknown): string | null {
  const inner = firstError(err);
  if (String(inner?.code ?? '').toLowerCase() !== 'form_identifier_exists') return null;
  const param = String(inner?.meta?.paramName ?? '').toLowerCase();
  if (param === 'username') return 'That username is taken. Try another.';
  if (param === 'phone_number') return 'That phone number is already in use.';
  if (param === 'email_address') return 'That email is already in use. Try a different one.';
  return 'Check what you entered and try again.';
}

export function existingAccountCopy(role: 'buyer' | 'seller'): string {
  return role === 'seller'
    ? 'This email already has a seller account.'
    : 'This email already has a buyer account.';
}
