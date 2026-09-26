import { Platform } from 'react-native';

/**
 * Temporary Expo Go buyer preview: skip onboarding in development on native
 * without persisting a fake completion or changing production authentication.
 * Remove the native 'buyer' branch to restore the normal Expo Go entry flow.
 * Web's optional role override remains independent.
 */
const envRole = process.env.EXPO_PUBLIC_DEV_BYPASS_ROLE;
export const DEV_BYPASS_ROLE: 'buyer' | 'seller' | null =
  !__DEV__ ? null
    : Platform.OS !== 'web' ? 'buyer'
    : envRole === 'buyer' || envRole === 'seller' ? envRole
    : null;
