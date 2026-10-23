import { safeReturnTo } from './guestRoutes';
import { router } from 'expo-router';

/** A prompt carries navigation only, never a callback that could replay a purchase. */
export type GuestSignInRequest = { returnTo: string; onDismiss?: () => void; beforeEmailSignIn?: () => void };
let request: GuestSignInRequest | null = null;
const listeners = new Set<() => void>();
export const subscribeGuestSignIn = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getGuestSignInRequest = () => request;
export function requestGuestSignIn(returnTo: string, onDismiss?: () => void, beforeEmailSignIn?: () => void) {
  // Compatibility for retained action handlers after a session expires.
  // No guest sheet or inline screen remains; never replay the action.
  beforeEmailSignIn?.();
  router.replace({ pathname: '/onboarding', params: { returnTo: safeReturnTo(returnTo) ?? '/' } } as never);
}
export function closeGuestSignIn(dismiss = true) {
  const previous = request;
  request = null;
  listeners.forEach(listener => listener());
  if (dismiss) previous?.onDismiss?.();
}

export function guestReturnPath(pathname: string, params: Record<string, unknown>) {
  const query = Object.entries(params)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
    .join('&');
  return query ? `${pathname}?${query}` : pathname;
}
