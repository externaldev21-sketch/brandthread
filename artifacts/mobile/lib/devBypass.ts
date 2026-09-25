import { Platform } from 'react-native';

/**
 * Opt-in development entry bypass for the web preview only. A fresh Expo Go
 * install always uses real Clerk authentication and onboarding; production
 * builds never activate this.
 * Set EXPO_PUBLIC_DEV_BYPASS_ROLE=buyer|seller locally to skip straight to a
 * dashboard while iterating on non-onboarding web screens.
 */
const envRole = process.env.EXPO_PUBLIC_DEV_BYPASS_ROLE;
export const DEV_BYPASS_ROLE: 'buyer' | 'seller' | null =
  __DEV__ && Platform.OS === 'web' && (envRole === 'buyer' || envRole === 'seller') ? envRole : null;
