/**
 * The account every per-account cache is currently scoped to.
 *
 * app/_layout.tsx's ServiceConfigurer re-scopes the query client, the tab
 * data / feed caches, account storage and every service singleton when the
 * signed-in Clerk user changes, then calls `markAccountScope(userId)` once
 * all of that is done. Anything that must never read one account's caches
 * while another is signed in waits on this instead of Clerk's own userId
 * (which flips one render earlier, before the caches are re-scoped):
 *
 * - the tab shells key their navigators by `useAccountSwitchKey`, so an
 *   account switch mounts the new account's screens fresh instead of
 *   re-rendering the old account's retained scenes with the new user. It
 *   only changes when one signed-in account replaces another, so a cold
 *   start (signed out -> the stored account) never mounts the shell twice;
 * - the switch transition (lib/accountSwitchTransition.ts) keeps its cover
 *   up until it has moved to the target account.
 */
import { useSyncExternalStore } from 'react';

const ANON = 'anon';
let scope = ANON;
let lastSignedIn: string | null = null;
let switches = 0;
const listeners = new Set<() => void>();

export function markAccountScope(userId: string | null): void {
  const next = userId ?? ANON;
  if (next === scope) return;
  // Counted against the last signed-in account, so a brief signed-out
  // render in the middle of a switch still reads as a switch.
  if (userId) {
    if (lastSignedIn !== null && lastSignedIn !== userId) switches += 1;
    lastSignedIn = userId;
  }
  scope = next;
  listeners.forEach((listener) => listener());
}

export function getAccountScope(): string {
  return scope;
}

export function subscribeAccountScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Changes on every switch from one signed-in account to another. */
export function getAccountSwitchKey(): string {
  return `account-${switches}`;
}

export function useAccountSwitchKey(): string {
  return useSyncExternalStore(subscribeAccountScope, getAccountSwitchKey, getAccountSwitchKey);
}
