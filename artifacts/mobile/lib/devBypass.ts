/**
 * Temporary development-only entry bypass for Expo device testing.
 * Set to null when real sign-in and onboarding should be tested again.
 */
export const DEV_BYPASS_ROLE: 'buyer' | 'seller' | null = __DEV__ ? 'seller' : null;