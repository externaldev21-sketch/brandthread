/**
 * Opt-in development entry bypass for Expo device testing. Off by default so
 * a fresh Expo Go install always sees real splash -> sign-up -> onboarding.
 * Set EXPO_PUBLIC_DEV_BYPASS_ROLE=buyer|seller locally to skip straight to a
 * dashboard while iterating on non-onboarding screens.
 */
const envRole = process.env.EXPO_PUBLIC_DEV_BYPASS_ROLE;
export const DEV_BYPASS_ROLE: 'buyer' | 'seller' | null =
  __DEV__ && (envRole === 'buyer' || envRole === 'seller') ? envRole : null;