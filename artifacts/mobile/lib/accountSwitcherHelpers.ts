/**
 * Pure account-switcher logic — no React Native/Clerk imports, so it can be
 * unit-tested directly instead of only through a full component mount.
 */

/** A person can be logged into up to this many accounts (any buyer/seller mix) on one device. */
export const MAX_ACCOUNTS = 8;
export const MAX_ACCOUNTS_MESSAGE =
  'You can be logged into up to 8 accounts. Log out of one to add another.';

export interface SessionUserLike {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  primaryEmailAddress?: { emailAddress: string } | null;
}

export function getHandle(sessionUser: SessionUserLike, serverUsername?: string | null): string {
  const username = serverUsername ?? sessionUser.username;
  if (username) return `@${username}`;
  const email = sessionUser.primaryEmailAddress?.emailAddress;
  return email ? `@${email.split('@')[0]}` : '@you';
}

export function getDisplayName(sessionUser: SessionUserLike, serverDisplayName?: string | null): string {
  if (serverDisplayName) return serverDisplayName;
  const parts = [sessionUser.firstName, sessionUser.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return sessionUser.username ?? 'Your account';
}

/**
 * The active session can trust the live local role instantly; every other
 * session relies on the server's account-types lookup (Clerk's session/user
 * object carries no buyer/seller signal of its own).
 */
export function resolveAccountTypeLabel(
  isActive: boolean,
  localRole: 'buyer' | 'seller' | null,
  serverAccountType: 'buyer' | 'seller' | null | undefined,
): 'Buyer' | 'Seller' {
  return (isActive ? localRole : serverAccountType) === 'seller' ? 'Seller' : 'Buyer';
}

export function isAtAccountCap(activeSessionCount: number): boolean {
  return activeSessionCount >= MAX_ACCOUNTS;
}
