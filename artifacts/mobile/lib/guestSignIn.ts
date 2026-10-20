import { safeReturnTo } from './guestRoutes';

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
  if (request) return; // Repeated taps must not stack prompts.
  request = { returnTo: safeReturnTo(returnTo) ?? '/(buyer)/', onDismiss, beforeEmailSignIn };
  listeners.forEach(listener => listener());
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
