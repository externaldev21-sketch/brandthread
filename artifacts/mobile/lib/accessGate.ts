/**
 * Invite-only launch mode: remembers, for this app session, which account has
 * just redeemed an access code, so AuthGate stops routing that account back to
 * /access-code while its own status re-check is still in flight. The server
 * (POST /api/auth/onboarding/complete) remains the authority.
 */
let clearedUserId: string | null = null;

export function markAccessCleared(userId: string | null | undefined): void {
  clearedUserId = userId ?? null;
}

export function isAccessCleared(userId: string | null | undefined): boolean {
  return Boolean(userId) && clearedUserId === userId;
}
