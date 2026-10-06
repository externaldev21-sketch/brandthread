import { Redirect } from 'expo-router';

// Redirect-only route: it never paints, so it has no ScreenHeader of its own.

/**
 * `plan-details` is declared in the root Stack (app/_layout.tsx) and mapped in
 * SellerGlobalTabBar, but had no screen, so Expo Router warned on every load
 * and a link here was a dead end. A seller's plan details live on the
 * Subscription screen.
 */
export default function PlanDetailsScreen() {
  return <Redirect href={'/subscription' as never} />;
}
