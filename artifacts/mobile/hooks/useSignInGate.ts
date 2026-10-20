/**
 * Inline account gate for guests (App Store Review Guideline 5.1.1(v)).
 *
 * Call `requireSignIn()` at the top of an action that needs an account (buy,
 * follow, like, save, message, post). Signed in: returns true and nothing
 * happens. Signed out: opens the shared dismissible sheet and returns false.
 * No action is replayed automatically after authentication.
 */
import { useCallback } from 'react';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { guestReturnPath, requestGuestSignIn } from '@/lib/guestSignIn';

export function useSignInGate() {
  const { isSignedIn: clerkSignedIn, isLoaded } = useAuth();
  const isSignedIn = !!(isLoaded && clerkSignedIn);
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  /** Show the prompt over the current screen without navigating away. */
  const goToSignIn = useCallback((): void => {
    requestGuestSignIn(guestReturnPath(pathname, params));
  }, [pathname, params]);

  const requireSignIn = useCallback((): boolean => {
    if (isSignedIn) return true;
    goToSignIn();
    return false;
  }, [isSignedIn, goToSignIn]);

  return { isSignedIn: !!isSignedIn, requireSignIn, goToSignIn };
}
