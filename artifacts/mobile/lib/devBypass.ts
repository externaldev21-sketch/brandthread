import { Platform } from 'react-native';
import { DEV_SELLER_PREVIEW, DEV_WEB_BYPASS_ROLE } from './buildFlags';

/**
 * Temporary development-only role bypass. Native defaults to the normal
 * onboarding flow; the seller preview must be explicitly opted into.
 */
export const DEV_BYPASS_ROLE: 'buyer' | 'seller' | null =
  !__DEV__ ? null
    : Platform.OS !== 'web' ? (DEV_SELLER_PREVIEW ? 'seller' : null)
    : DEV_WEB_BYPASS_ROLE;
