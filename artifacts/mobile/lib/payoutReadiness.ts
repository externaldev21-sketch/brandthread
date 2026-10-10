/**
 * BT-206: a listing can go live before the seller has set up payouts, but
 * buyers can't check out until they have. Publishing is never blocked; the
 * seller is told first and can set payouts up or publish anyway.
 *
 * Pure module: no react-native imports, safe to unit test.
 */
import { isStripeFullyConnected, normalizeConnectStatus } from './stripeConnectStatus';

export const PAYOUTS_MISSING_TITLE = 'Payouts aren’t set up';
export const PAYOUTS_MISSING_MESSAGE = 'Buyers can’t check out until you set up payouts.';

/**
 * True only when the server says the seller's account can't take payments.
 * An unknown status (offline, lookup failed) or an environment without a
 * payment provider never interrupts publishing.
 */
export function payoutsMissingForPublish(rawStatus: unknown): boolean {
  const status = normalizeConnectStatus(rawStatus);
  if (!status || !status.providerConfigured) return false;
  return !isStripeFullyConnected(status);
}
