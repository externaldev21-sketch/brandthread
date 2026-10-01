/**
 * Contact sync ("Find friends from contacts") feature flag — default OFF.
 * Set EXPO_PUBLIC_CONTACT_SYNC_ENABLED=true (and CONTACT_SYNC_ENABLED=true on the API) to enable.
 * Referenced statically so Expo inlines the value at build time.
 */
export const CONTACT_SYNC_ENABLED = /^(1|true|on|yes)$/i.test(
  (process.env.EXPO_PUBLIC_CONTACT_SYNC_ENABLED ?? '').trim(),
);
