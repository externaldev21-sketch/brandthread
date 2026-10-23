/**
 * Defensive account-action guard; navigation itself is account-gated.
 *
 * Call `requireSignIn()` at the top of an action that needs an account (buy,
 * follow, like, save, message, post). Signed in: returns true and nothing
 * happens. An expired session goes to Welcome, never an inline guest sheet.
 * No action is replayed automatically after authentication.
 */
import { useCallback } from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { guestReturnPath } from '@/lib/guestSignIn';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';

export function useSignInGate() {
  const { isSignedIn: clerkSignedIn, isLoaded } = useAuth();
  const preview = isBuyerDevPreview() || isSellerDevPreview() || !!DEV_BYPASS_ROLE;
  const isSignedIn = !!(isLoaded && clerkSignedIn) || preview;
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const router = useRouter();

  /** Only remember navigation; no action is automatically replayed. */
  const goToSignIn = useCallback((): void => {
    if (preview) return;
    router.replace({ pathname: '/onboarding', params: { returnTo: guestReturnPath(pathname, params) } } as never);
  }, [pathname, params, preview, router]);

  const requireSignIn = useCallback((): boolean => {
    if (isSignedIn) return true;
    goToSignIn();
    return false;
  }, [isSignedIn, goToSignIn]);

  return { isSignedIn: !!isSignedIn, requireSignIn, goToSignIn };
}
