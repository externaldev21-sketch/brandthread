/**
 * Maps Clerk / server errors raised by the account-security screens (change
 * password, email, phone, 2FA) to short copy a person can act on.
 *
 * Clerk v6 API errors look like `{ errors: [{ code, message, longMessage }] }`;
 * runtime errors (e.g. the reverification prompt being dismissed) carry a
 * top-level `code`.
 */
export type SecurityErrorContext = 'password' | 'email' | 'phone' | 'code' | 'twoFactor' | 'generic';

export type SecurityErrorKind =
  | 'wrong_password'
  | 'weak_password'
  | 'breached_password'
  | 'identifier_taken'
  | 'invalid_format'
  | 'wrong_code'
  | 'expired_code'
  | 'rate_limited'
  | 'reverification'
  | 'cancelled'
  | 'locked'
  | 'network'
  | 'unknown';

export type MappedSecurityError = { kind: SecurityErrorKind; message: string };

function codesOf(err: unknown): string[] {
  const e = err as { code?: unknown; errors?: Array<{ code?: unknown }> } | null | undefined;
  const codes: string[] = [];
  if (e && typeof e.code === 'string') codes.push(e.code);
  if (e && Array.isArray(e.errors)) {
    for (const item of e.errors) if (item && typeof item.code === 'string') codes.push(item.code);
  }
  return codes;
}

export function mapSecurityError(err: unknown, context: SecurityErrorContext = 'generic'): MappedSecurityError {
  const codes = codesOf(err);
  const has = (...wanted: string[]) => wanted.some((code) => codes.includes(code));
  const what = context === 'email' ? 'email address' : context === 'phone' ? 'phone number' : 'details';

  if (has('session_reverification_required')) {
    return { kind: 'reverification', message: 'For your security, sign out and back in, then try again.' };
  }
  if (has('reverification_cancelled', 'reverification_cancelled_by_user')) {
    return { kind: 'cancelled', message: "We didn't change anything because verification was cancelled." };
  }
  if (has('form_password_incorrect', 'strategy_for_user_invalid')) {
    return { kind: 'wrong_password', message: 'Your current password is incorrect.' };
  }
  if (has('form_password_pwned', 'form_password_pwned__sign_in')) {
    return { kind: 'breached_password', message: 'That password appeared in a data breach. Choose a different one.' };
  }
  if (has('form_password_length_too_short', 'form_password_not_strong_enough', 'form_password_validation_failed', 'form_password_size_in_bytes_exceeded')) {
    return { kind: 'weak_password', message: 'Use at least 8 characters and avoid common passwords.' };
  }
  if (has('form_identifier_exists', 'form_email_address_exists', 'form_phone_number_exists')) {
    return { kind: 'identifier_taken', message: `That ${what} is already used by another account.` };
  }
  if (has('form_param_format_invalid', 'form_identifier_invalid', 'form_phone_number_invalid')) {
    return { kind: 'invalid_format', message: context === 'phone' ? 'Enter a valid phone number with its country code.' : 'Enter a valid email address.' };
  }
  if (has('form_code_incorrect', 'verification_failed', 'form_param_value_invalid')) {
    return { kind: 'wrong_code', message: "That code isn't right. Try again." };
  }
  if (has('verification_expired', 'form_code_expired')) {
    return { kind: 'expired_code', message: 'That code expired. Request a new one.' };
  }
  if (has('too_many_requests', 'rate_limit_exceeded')) {
    return { kind: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' };
  }
  if (has('user_locked', 'session_exists')) {
    return { kind: 'locked', message: 'Your account is temporarily locked. Try again later.' };
  }
  const message = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof message === 'string' && /network|fetch|timeout|offline/i.test(message)) {
    return { kind: 'network', message: "Couldn't reach Brandthread. Check your connection and try again." };
  }
  return { kind: 'unknown', message: context === 'password' ? "Couldn't change your password. Try again." : `Couldn't update your ${what}. Try again.` };
}

export type PasswordChangeInput = { current: string; next: string; confirm: string; requireCurrent: boolean };

/** Client-side checks that run before any Clerk call. Returns an error message or null. */
export function validatePasswordChange({ current, next, confirm, requireCurrent }: PasswordChangeInput): string | null {
  if (requireCurrent && !current) return 'Enter your current password.';
  if (next.length < 8) return 'Use at least 8 characters.';
  if (requireCurrent && next === current) return 'Choose a password you have not used here before.';
  if (next !== confirm) return 'Passwords do not match.';
  return null;
}

/** Normalises a phone entry to E.164-ish; returns null when it cannot be a phone number. */
export function normalizePhoneForClerk(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  if (trimmed.startsWith('+')) return `+${digits}`;
  // Bare US/CA numbers are the common case; anything else must include a country code.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** "Next change" copy for the @handle cooldown. */
export function formatHandleCooldown(nextChangeAtIso: string, now: Date = new Date()): string {
  const next = new Date(nextChangeAtIso);
  const days = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 86_400_000));
  const date = next.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `You can change your username again on ${date} (${days} ${days === 1 ? 'day' : 'days'}).`;
}
