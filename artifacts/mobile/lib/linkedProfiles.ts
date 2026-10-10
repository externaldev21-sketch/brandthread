/**
 * One login = at most one buyer profile + one seller profile (server:
 * artifacts/api-server/src/routes/accounts.ts). The other-role profile is its
 * own account in public; this login just reaches it without a second sign-up.
 * Pure helpers, no React, so they are easy to test.
 */
import type { LinkedProfile } from '@/lib/api';

export type ProfileRole = 'buyer' | 'seller';

/** Same keys app/onboarding.tsx and app/_layout.tsx read. */
export const ONBOARDING_PENDING_FLOW_KEY = 'onboarding_pending_flow';
export const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

export function otherRole(role: ProfileRole | null | undefined): ProfileRole {
  return role === 'seller' ? 'buyer' : 'seller';
}

/** Settings row / switcher action for adding the other-role profile. */
export function addProfileLabel(role: ProfileRole): string {
  return role === 'seller' ? 'Start selling' : 'Shop as a buyer';
}

export function roleExistsMessage(role: ProfileRole): string {
  return role === 'seller'
    ? 'This email already has a seller account.'
    : 'This email already has a buyer account.';
}

export type StartProfileOutcome =
  | { kind: 'started' }
  | { kind: 'exists'; role: ProfileRole; profileClerkId: string | null }
  | { kind: 'finish-setup' }
  | { kind: 'error'; message: string };

/** Reads the server's 409 for "this login already has that role". */
export function parseStartProfileError(err: unknown, role: ProfileRole): StartProfileOutcome {
  const e = err as { status?: number; code?: string; body?: string; message?: string } | null;
  if (e?.status === 409 && e.code === 'PROFILE_ROLE_EXISTS') {
    let profileClerkId: string | null = null;
    try { profileClerkId = (JSON.parse(e.body ?? '{}') as { profileClerkId?: string }).profileClerkId ?? null; } catch { /* keep null */ }
    return { kind: 'exists', role, profileClerkId };
  }
  if (e?.status === 409 && e.code === 'FINISH_SETUP') return { kind: 'finish-setup' };
  return { kind: 'error', message: e?.message && e.status && e.status < 500 ? e.message : "Couldn't do that right now. Try again." };
}

export interface SwitcherSession { id: string; status?: string; user?: { id?: string } | null }

/**
 * Profiles of this login that have no session on this device yet (new phone,
 * or logged out of that one). The switcher lists them so one tap gets in.
 */
export function profilesMissingFromDevice(
  profiles: readonly LinkedProfile[] | null | undefined,
  sessions: readonly SwitcherSession[] | null | undefined,
): LinkedProfile[] {
  const onDevice = new Set(
    (sessions ?? []).filter((s) => s.status === undefined || s.status === 'active').map((s) => s.user?.id).filter(Boolean),
  );
  return (profiles ?? []).filter((p) => !p.isCurrent && !p.pendingDeletion && !onDevice.has(p.clerkId));
}

export function sessionForProfile<S extends SwitcherSession>(sessions: readonly S[] | null | undefined, clerkId: string): S | null {
  return (sessions ?? []).find((s) => (s.status === undefined || s.status === 'active') && s.user?.id === clerkId) ?? null;
}

/**
 * Signed-out dev web preview (`?bt_preview=buyer|seller`) has no account to
 * ask. Fresh preview: just the current profile, so "Start selling" / "Shop as
 * a buyer" is offered. `demo=1`: both profiles (the preview buyer @ava and
 * the preview seller from lib/previewIdentity.ts).
 */
export function previewLinkedProfiles(
  role: ProfileRole,
  demo: boolean,
  sellerIdentity: { username: string; brandName: string },
): { profiles: LinkedProfile[]; canAdd: { buyer: boolean; seller: boolean } } {
  const buyer: LinkedProfile = {
    clerkId: 'preview-buyer', role: 'buyer', username: 'ava', displayName: 'Ava', avatarUrl: null,
    onboardingComplete: true, isLogin: true, isCurrent: role === 'buyer', pendingDeletion: false,
  };
  const seller: LinkedProfile = {
    clerkId: 'preview-seller', role: 'seller', username: sellerIdentity.username, displayName: sellerIdentity.brandName, avatarUrl: null,
    onboardingComplete: true, isLogin: false, isCurrent: role === 'seller', pendingDeletion: false,
  };
  const profiles = demo ? [buyer, seller] : [role === 'seller' ? seller : buyer];
  return { profiles, canAdd: { buyer: !profiles.some((p) => p.role === 'buyer'), seller: !profiles.some((p) => p.role === 'seller') } };
}
