export const BRANDTHREAD_URL_SCHEME = 'brandthread';
export const APPLE_OAUTH_STRATEGY = 'oauth_apple' as const;

type RedirectUriFactory = (options: { scheme: string }) => string;

export function makeBrandthreadRedirectUri(makeRedirectUri: RedirectUriFactory): string {
  return makeRedirectUri({ scheme: BRANDTHREAD_URL_SCHEME });
}

export function isOAuthFlowComplete(result: unknown): boolean {
  const value = result as {
    createdSessionId?: unknown;
  } | null | undefined;
  // Clerk's status objects can report complete before the native client has an
  // active session. Onboarding may advance only when startSSOFlow returned the
  // concrete session that this screen can activate.
  return typeof value?.createdSessionId === 'string' && value.createdSessionId.length > 0;
}

export function isOAuthCancellationError(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof value?.code === 'string' ? value.code.toLowerCase() : '';
  const message = typeof value?.message === 'string' ? value.message.toLowerCase() : '';
  return (
    code === 'user_cancelled' ||
    code === 'user_cancelled_authorization' ||
    code === 'authorization_canceled' ||
    message.includes('cancel') ||
    message.includes('dismiss')
  );
}

export function mapOAuthError(provider: string, error: unknown): string {
  const value = error as {
    code?: unknown;
    message?: unknown;
    errors?: Array<{ code?: unknown; message?: unknown; longMessage?: unknown }>;
  } | null | undefined;
  const inner = value?.errors?.[0] ?? value;
  const code = typeof inner?.code === 'string' ? inner.code.toLowerCase() : '';
  const message = typeof (inner as { message?: unknown })?.message === 'string'
    ? (inner as { message: string }).message.toLowerCase()
    : typeof (inner as { longMessage?: unknown })?.longMessage === 'string'
      ? (inner as { longMessage: string }).longMessage.toLowerCase()
      : '';

  if (code === 'form_identifier_exists' || code === 'account_exists' || message.includes('already exists')) {
    return 'An account already exists. Sign in with the existing account instead.';
  }
  if (code === 'access_denied' || code === 'user_denied' || message.includes('denied')) {
    return `${provider} sign-in was declined. You can try again whenever you’re ready.`;
  }
  if (
    code === 'invalid_grant' ||
    code === 'token_revoked' ||
    code === 'credential_revoked' ||
    message.includes('revoked') ||
    message.includes('invalid grant')
  ) {
    return `${provider} authorization expired or was revoked. Start sign-in again.`;
  }
  if (
    code === 'redirect_uri_mismatch' ||
    code === 'redirect_failed' ||
    message.includes('redirect') ||
    message.includes('deep link')
  ) {
    return `${provider} sign-in was interrupted before it could return to Brandthread. Try again.`;
  }
  if (
    code === 'network_failure' ||
    code === 'request_timeout' ||
    message.includes('network') ||
    message.includes('timeout')
  ) {
    return `Couldn't connect to ${provider}. Check your internet and try again.`;
  }
  return `${provider} sign-in failed. Please try again.`;
}