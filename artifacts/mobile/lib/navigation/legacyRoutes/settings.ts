import type { LegacyRoute } from './types';

/**
 * Settings: the buyer profile Menu and the buyer Settings hub are one
 * "Settings and activity" screen (Instagram); seller settings follow Shopify.
 */
export const SETTINGS_LEGACY_ROUTES: LegacyRoute[] = [
  { from: '/buyer-settings-menu', to: '/buyer-settings', note: 'Profile Menu merged into Settings and activity.' },
  { from: '/buyer-login-activity', to: '/login-activity', note: 'Same screen as the seller one (Clerk sessions); one route now.' },
  { from: '/customer-events', to: '/store-pixels', note: '"Not available yet" placeholder; pixel tracking lives in Store pixels.' },
];
