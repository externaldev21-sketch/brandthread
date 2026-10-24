/**
 * Gates the Studio carousel's Activity card on `/seller-activity` existing.
 * There's no runtime way to ask Expo Router "does this route exist" — routes
 * are resolved from the file system at build time, not discoverable
 * on-device — so this is a flag rather than a live check. `app/seller-activity.tsx`
 * has landed, so the card is on; set this back to `false` only if that
 * route is removed.
 */
export const SELLER_ACTIVITY_ROUTE_LIVE = true;
