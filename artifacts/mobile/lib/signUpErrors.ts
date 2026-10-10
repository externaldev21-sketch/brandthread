/**
 * Decides what a failed Clerk sign-up actually means, so the onboarding
 * "This email already has an account" screen only ever appears when the EMAIL
 * the person typed really belongs to an account.
 *
 * Clerk reports every duplicate identifier as `form_identifier_exists` and
 * names the field in `meta.paramName` (email_address, username,
 * phone_number). Treating the bare code as "email exists" sent people with a
 * brand-new email to the "account exists" screen when something else collided.
 */

export type SignUpErrorOutcome =
  | { kind: 'email-exists' }
  | { kind: 'username-taken'; message: string }
  | { kind: 'signed-in-elsewhere' }
  | { kind: 'field'; message: string };

type ClerkLikeError = {
  code?: string;
  message?: string;
  longMessage?: string;
  meta?: { paramName?: string; param_name?: string };
  errors?: ClerkLikeError[];
};

function firstError(err: unknown): ClerkLikeError {
  const e = (err ?? {}) as ClerkLikeError;
  return e.errors?.[0] ?? e;
}

export function clerkErrorCode(err: unknown): string {
  return String(firstError(err).code ?? '').toLowerCase();
}

export function clerkErrorParam(err: unknown): string {
  const inner = firstError(err);
  return String(inner.meta?.paramName ?? inner.meta?.param_name ?? '').toLowerCase();
}

/**
 * @param err           what signUp.create()/password() returned or threw
 * @param fallbackMessage mapped copy for anything that isn't a duplicate
 */
export function classifySignUpError(err: unknown, fallbackMessage: string): SignUpErrorOutcome {
  const code = clerkErrorCode(err);
  if (code === 'session_exists' || code === 'identifier_already_signed_in') {
    return { kind: 'signed-in-elsewhere' };
  }
  if (code === 'form_identifier_exists') {
    const param = clerkErrorParam(err);
    if (param === 'email_address') return { kind: 'email-exists' };
    if (param === 'username') return { kind: 'username-taken', message: 'That username is taken.' };
    if (param === 'phone_number') return { kind: 'field', message: 'That phone number is already in use.' };
    // No field named: never claim the email exists on a guess.
    return { kind: 'field', message: "We couldn't create the account. Check your details and try again." };
  }
  return { kind: 'field', message: fallbackMessage };
}

/**
 * Picks a signed-in session on this device whose account uses `email`, so the
 * "account exists" screen can switch to it in one tap.
 */
export function findSessionForEmail<S extends {
  id: string;
  status?: string;
  user?: { id?: string; emailAddresses?: readonly { emailAddress?: string | null }[] } | null;
}>(sessions: readonly S[] | null | undefined, email: string): S | null {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  return (sessions ?? []).find((session) =>
    (session.status === undefined || session.status === 'active')
    && (session.user?.emailAddresses ?? []).some(
      (address) => (address.emailAddress ?? '').trim().toLowerCase() === target,
    ),
  ) ?? null;
}

/** Copy for the real "email already has an account" case. */
export function existingAccountHeadline(role: 'buyer' | 'seller' | null | undefined): string {
  if (role === 'buyer') return 'This email already has a buyer account.';
  if (role === 'seller') return 'This email already has a seller account.';
  return 'This email already has an account.';
}
