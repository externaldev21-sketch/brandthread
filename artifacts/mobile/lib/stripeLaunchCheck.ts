/**
 * Launch check for in-app payments (BT-271).
 *
 * stripePaymentAvailable() (components/checkout/StripePayment*.tsx) quietly
 * returns false when EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing from the
 * build, or when the build has no Stripe native module. Every buyer then
 * falls back to the hosted Stripe page with no Apple Pay / Google Pay sheet,
 * and nothing says why. In a production build that is a launch bug, so it is
 * reported once per app session: to Sentry (lib/monitoring.ts reportError)
 * and to the console.
 *
 * Setup steps for Dev: docs/launch/apple-pay-merchant-setup.md.
 *
 * Pure module apart from the injected reporter: safe to unit test.
 */

export type StripeUnavailableReason = 'missing_publishable_key' | 'native_module_missing';

/** Why the app can't take payments itself, or null when it can. */
export function stripeUnavailableReason(input: { hasPublishableKey: boolean; nativeModulePresent: boolean }): StripeUnavailableReason | null {
  if (!input.hasPublishableKey) return 'missing_publishable_key';
  if (!input.nativeModulePresent) return 'native_module_missing';
  return null;
}

/**
 * Only production builds report: development builds and Expo Go have no
 * Stripe module or key on purpose.
 */
export function shouldReportStripeUnavailable(input: { isDev: boolean; isExpoGo: boolean }): boolean {
  return !input.isDev && !input.isExpoGo;
}

export const STRIPE_UNAVAILABLE_MESSAGE =
  'In-app payments are off in this production build: checkout falls back to the hosted Stripe page. See docs/launch/apple-pay-merchant-setup.md.';

let reported = false;

/**
 * Reports once per app session. Returns true when it reported this time.
 * `report` is lib/monitoring.ts reportError in the app; tests pass a spy.
 */
export function reportStripeUnavailableOnce(
  reason: StripeUnavailableReason,
  platform: string,
  report: (error: Error, context: { tags: Record<string, string> }) => void,
  log: (message: string) => void = (message) => console.warn(message),
): boolean {
  if (reported) return false;
  reported = true;
  try {
    report(new Error(`Stripe in-app payments unavailable: ${reason}`), {
      tags: { area: 'checkout', check: 'stripe_payment_available', reason, platform },
    });
  } catch {
    // Never let reporting break checkout.
  }
  log(`${STRIPE_UNAVAILABLE_MESSAGE} (${reason})`);
  return true;
}

/** Tests only. */
export function resetStripeLaunchCheckForTests(): void {
  reported = false;
}
