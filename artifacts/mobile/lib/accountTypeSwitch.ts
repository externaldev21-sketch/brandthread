/**
 * Buyer <-> seller account-type switching (Settings -> Account type).
 *
 * Plain, RN-free logic so it can be unit tested:
 *  - whether a buyer who switches to seller still has to set up a brand
 *    (the same fields POST /api/auth/onboarding/complete requires for sellers:
 *    a non-empty brandName and brandStage),
 *  - where the app should land after the switch,
 *  - a readable error for a failed switch (including the server's age gate),
 *  - a tiny in-memory pub/sub so the root AuthGate picks up the new role the
 *    instant the switch succeeds, instead of only on a later AsyncStorage read
 *    (which is why the old flow said "Restart the app to apply").
 */

export type SwitchAccountType = 'buyer' | 'seller';

/** Mirrors the seller onboarding brand-stage choices (app/onboarding.tsx BRAND_STAGES). */
export const SELLER_BRAND_STAGES: ReadonlyArray<{ value: string; label: string; sub: string }> = [
  { value: 'idea',    label: 'Just an idea',    sub: "I'm starting from zero." },
  { value: 'build',   label: 'Building now',    sub: "I'm designing or sourcing products." },
  { value: 'selling', label: 'Already selling', sub: 'I have customers and active orders.' },
  { value: 'scale',   label: 'Ready to scale',  sub: 'I need stronger systems and growth.' },
];

export interface SellerSetupProfileFields {
  brandName?: string | null;
  brandStage?: string | null;
}

/** True when the account is missing the brand fields every seller account needs. */
export function needsSellerSetup(profile: SellerSetupProfileFields | null | undefined): boolean {
  const brandName = typeof profile?.brandName === 'string' ? profile.brandName.trim() : '';
  const brandStage = typeof profile?.brandStage === 'string' ? profile.brandStage.trim() : '';
  return brandName.length === 0 || brandStage.length === 0;
}

export interface SwitchDestination {
  /** Home of the new role (replaces the settings stack). */
  home: '/(buyer)/' | '/(tabs)/';
  /** Optional follow-up screen pushed on top of the new home. */
  next: '/setup' | null;
}

/**
 * Where to go once the server has accepted the new account type. A buyer who
 * just set up a brand as part of the switch continues into the seller store
 * setup checklist rather than an empty dashboard.
 */
export function destinationAfterSwitch(
  target: SwitchAccountType,
  opts: { completedSellerSetupNow?: boolean } = {},
): SwitchDestination {
  if (target === 'buyer') return { home: '/(buyer)/', next: null };
  return { home: '/(tabs)/', next: opts.completedSellerSetupNow ? '/setup' : null };
}

export const SWITCH_AGE_RESTRICTED_MESSAGE =
  'You must be 18 or older to switch to a seller account. Your account is still a buyer account.';

/** Human-readable reason a switch failed, preferring the server's own message. */
export function accountTypeSwitchErrorMessage(error: unknown): string {
  const e = (error && typeof error === 'object' ? error : {}) as {
    status?: unknown; code?: unknown; message?: unknown;
  };
  if (e.code === 'AGE_RESTRICTED') return SWITCH_AGE_RESTRICTED_MESSAGE;
  if (e.code === 'USERNAME_TAKEN') return 'That username is already taken.';
  const raw = typeof e.message === 'string' ? e.message : '';
  // ApiError messages are "API <status>: <server message>".
  const serverMessage = raw.replace(/^API \d{3}:\s*/, '').trim();
  if (e.status === 408 || /timed out/i.test(serverMessage)) {
    return 'The request timed out. Check your connection and try again.';
  }
  if (e.status === 401) return 'Your session expired. Sign in again and retry.';
  const looksLikeJson = serverMessage.startsWith('{') || serverMessage.startsWith('<');
  if (serverMessage && !looksLikeJson && serverMessage.length <= 200) return serverMessage;
  return 'Could not update your account type. Check your connection and try again.';
}

// ── role-change bus ──────────────────────────────────────────────────────────

type RoleListener = (role: SwitchAccountType) => void;
const roleListeners = new Set<RoleListener>();

/** Subscribe to successful account-type switches. Returns an unsubscribe fn. */
export function onAccountRoleChanged(listener: RoleListener): () => void {
  roleListeners.add(listener);
  return () => { roleListeners.delete(listener); };
}

/** Announce a switch the server already accepted. */
export function emitAccountRoleChanged(role: SwitchAccountType): void {
  roleListeners.forEach((fn) => {
    try { fn(role); } catch { /* one listener never blocks the rest */ }
  });
}
