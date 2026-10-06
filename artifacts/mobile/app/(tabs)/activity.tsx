/**
 * Seller-side `/activity` — same shared screen as ../activity-center.
 *
 * Route groups add no path segment, so `/activity` resolves to the only
 * same-named file, app/(buyer)/activity.tsx. AuthGate (app/_layout.tsx) then
 * corrects a seller who lands in the (buyer) group to the equivalent
 * `/(tabs)/<rest>` route — which didn't exist for `activity`, so sellers hit
 * Not Found. This re-export gives that correction a real target. The seller
 * bar (SellerGlobalTabBar) renders at the root, so no Tabs.Screen entry or
 * tab-bar change is needed. The title comes from activity-center's own
 * ScreenHeader.
 */
export { default } from '../activity-center';
