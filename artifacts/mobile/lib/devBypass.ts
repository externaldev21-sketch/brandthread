/**
 * Native Expo Go always uses real Clerk authentication and onboarding.
 * Review-only, unauthenticated preview navigation is confined to dev web.
 */
export const DEV_BYPASS_ROLE: 'buyer' | 'seller' | null = null;