/**
 * Platform-neutral fallback for tooling that does not apply Expo's platform
 * suffix resolution. Metro selects revenueCat.native.tsx or revenueCat.web.tsx
 * before reaching this file.
 */
export { RevenueCatProvider, useRevenueCat } from './revenueCat.web';