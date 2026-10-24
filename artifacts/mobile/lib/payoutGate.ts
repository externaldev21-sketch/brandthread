/**
 * Seller payout gate (client side). The API refuses to take a listing live
 * until the seller's Stripe Connect account can take charges and send payouts
 * (`PAYOUTS_NOT_READY`, see api-server/src/lib/payoutGate.ts). The listing
 * flow saves such a listing as a draft and shows the Set up payouts card; the
 * dashboard asks sellers with listings that went live before the gate to
 * finish setup. Nothing is ever unpublished from here.
 *
 * Demo / preview sellers (signed-out ?bt_preview=seller) skip the gate, same
 * as the other payment checks (payouts.tsx, payout-setup.tsx) — they have no
 * real account to check.
 */
export const PAYOUTS_NOT_READY = 'PAYOUTS_NOT_READY';

export type PayoutGateState = {
  /** null until the first check resolves (or when it failed). */
  ready: boolean | null;
  liveProductCount: number;
};

/**
 * Status to actually save. A new go-live is held back as a draft while payouts
 * are not ready; a listing that is already live stays live (no auto-unpublish).
 */
export function resolvePublishStatus(input: {
  requested: 'active' | 'draft';
  payoutsReady: boolean | null;
  alreadyLive: boolean;
}): { status: 'active' | 'draft'; heldForPayouts: boolean } {
  if (input.requested === 'active' && input.payoutsReady === false && !input.alreadyLive) {
    return { status: 'draft', heldForPayouts: true };
  }
  return { status: input.requested, heldForPayouts: false };
}

/** Dashboard banner: live listings exist but payouts are not set up. */
export function shouldShowFinishPayoutBanner(state: PayoutGateState): boolean {
  return state.ready === false && state.liveProductCount > 0;
}

export function isPayoutsNotReadyError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === PAYOUTS_NOT_READY;
}
