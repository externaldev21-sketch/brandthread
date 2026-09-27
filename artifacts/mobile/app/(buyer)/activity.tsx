/**
 * Buyer-tab-nested re-export of ../activity-center — same screen, reached
 * from the floating tab bar's Activity slot. Registered here (not just at
 * the root `activity-center` route) so it's a Tabs.Screen the buyer Tabs
 * navigator keeps mounted, the same way it does for Friends/Cart/Orders/
 * Following/Edit profile — otherwise pushing the root-level route replaces
 * the whole (buyer) screen, floating tab bar included, which is exactly the
 * "tab bar disappears when you tap the bell" bug this route exists to fix.
 * The root `app/activity-center.tsx` route is unchanged and still used by
 * the seller side's `ActivityBellButton` instances.
 */
export { default } from '../activity-center';
