/**
 * Inline account gate for guests (App Store Review Guideline 5.1.1(v)).
 *
 * Call `requireSignIn()` at the top of an action that needs an account (buy,
 * follow, like, save, message, post). Signed in: returns true and nothing
 * happens. Signed out: opens the existing sign-in screen with `returnTo`
 * set to the current route, and returns false so the caller stops. No new
 * sheet or interstitial.
 */
import { useCallback } from 'react';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';

export function useSignInGate() {
  const { isSignedIn: clerkSignedIn, userId } = useAuth();
  const isSignedIn = !!(clerkSignedIn || userId);
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  // Dev/screenshot previews run signed out by design; never gate them.
  const preview = isBuyerDevPreview() || isSellerDevPreview() || !!DEV_BYPASS_ROLE;

  /** Open the existing sign-in screen; after signing in the user returns here. */
  const goToSignIn = useCallback((): void => {
    const query = Object.entries(params)
      .filter(([, v]) => typeof v === 'string' && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
      .join('&');
    const returnTo = query ? `${pathname}?${query}` : pathname;
    router.push({ pathname: '/sign-in', params: { returnTo } } as never);
  }, [router, pathname, params]);

  const requireSignIn = useCallback((): boolean => {
    if (isSignedIn || preview) return true;
    goToSignIn();
    return false;
  }, [isSignedIn, preview, goToSignIn]);

  return { isSignedIn: !!isSignedIn, requireSignIn, goToSignIn };
}
