/**
 * Account wall: every app screen requires an account. A signed-out visitor is
 * sent to the welcome/sign-in flow by AuthGate in app/_layout.tsx, which
 * remembers the requested route and resumes it after sign-in.
 */

/**
 * Validate a `returnTo` param before navigating to it after sign-in: only
 * in-app absolute paths, never a protocol-relative/external URL or the auth
 * screens themselves (which would loop).
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('://') || v.includes('\\')) return null;
  const path = v.split('?')[0].split('#')[0];
  if (['/sign-in', '/forgot-password', '/splash', '/onboarding', '/'].includes(path)) return null;
  return v;
}
