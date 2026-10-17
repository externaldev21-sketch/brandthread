/**
 * Clerk error → one plain sentence for the onboarding screens. Moved out of
 * app/onboarding.tsx unchanged, plus `clerk_key_invalid`.
 */
export const CLERK_KEY_INVALID_CODE = 'clerk_key_invalid';

/** True for any error (Clerk or our API) caused by a rejected Clerk key. */
export function isClerkKeyInvalid(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; errors?: Array<{ code?: unknown }>; message?: unknown };
  if (e.code === CLERK_KEY_INVALID_CODE) return true;
  if (Array.isArray(e.errors) && e.errors.some((x) => x?.code === CLERK_KEY_INVALID_CODE)) return true;
  return typeof e.message === 'string' && e.message.includes(CLERK_KEY_INVALID_CODE);
}

export function mapClerkError(err: any): string {
  if (!err) return 'Something went wrong. Please try again.';

  const inner = err?.errors?.[0] ?? err;
  const code = (inner?.code ?? '').toLowerCase();
  const msg = (inner?.message ?? inner?.longMessage ?? err?.message ?? '').toLowerCase();

  if (isClerkKeyInvalid(err))
    return 'Sign-in is not available right now because of a server setup problem. Please try again later.';
  if (code === 'form_identifier_exists')
    return 'An account already exists with this email. Log in instead.';
  if (code === 'session_exists' || code === 'identifier_already_signed_in')
    return 'You are already signed in. Sign out to create another account.';
  if (code === 'form_password_pwned' || code === 'form_password_strength_insufficient')
    return 'This password is too common or weak. Choose a stronger one.';
  if (code === 'form_password_length_too_short')
    return 'Use at least 8 characters.';
  if (code === 'form_param_format_invalid' || code === 'form_param_nil')
    return msg.includes('email') ? 'Enter a valid email address.' : 'One of your entries is not in the right format.';
  if (code === 'form_code_incorrect')
    return 'That code isn’t right. Check your email and try again.';
  if (code === 'verification_expired')
    return 'That code has expired. Request a new one.';
  if (code === 'request_rate_limited' || code === 'too_many_requests')
    return 'Too many attempts. Please wait a moment and try again.';
  if (code === 'network_failure' || code === 'request_timeout')
    return 'Couldn’t connect. Check your internet and try again.';
  if (code === 'missing_publishable_key' || code === 'publishable_key_invalid')
    return 'Sign-in is not available right now because of an app setup problem. Please try again later.';
  if (code === 'form_identifier_not_found')
    return 'We couldn’t find an account with that email.';
  if (code === 'form_password_incorrect')
    return 'Incorrect email or password.';
  if (code === 'strategy_for_user_invalid' || code === 'not_allowed_access')
    return 'This account can’t log in with an email code. Log in with your password instead.';

  if (msg.includes('that email address is taken') || (msg.includes('email') && msg.includes('already exists') && !msg.includes('session')))
    return 'An account already exists with this email. Log in instead.';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout'))
    return 'Couldn’t connect. Check your internet and try again.';
  if (msg.includes('rate limit') || msg.includes('too many'))
    return 'Too many attempts. Please wait and try again.';

  return inner?.longMessage || inner?.message || err?.message || 'Something went wrong. Please try again.';
}
