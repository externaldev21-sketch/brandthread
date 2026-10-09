/**
 * `/seller-activity` is being built in parallel (session 018Y4ik1) and
 * doesn't exist on this branch yet. There's no runtime way to ask Expo
 * Router "does this route exist" — routes are resolved from the file system
 * at build time, not discoverable on-device — so the Studio carousel's
 * Activity card is gated behind this flag instead of a live check. Flip it
 * to `true` once `app/seller-activity.tsx` lands; the card then appears
 * automatically with no further change needed here.
 */
export const SELLER_ACTIVITY_ROUTE_LIVE = false;
