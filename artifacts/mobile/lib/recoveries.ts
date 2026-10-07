/**
 * View model for lost-chargeback recoveries (GET /api/finance/recoveries).
 * A chargeback lost after the seller was paid is pulled back from their
 * upcoming payouts; while anything is owed, payouts are paused. Pure
 * functions only, so the wording is unit-tested and the screen stays thin.
 */
import { formatCents } from './money';

export type RecoveryStatus = 'open' | 'recovered' | 'written_off' | 'reinstated';
export type RecoverySource =
  | 'transfer_reversal' | 'release_netting' | 'payout_netting' | 'manual' | 'write_off' | 'reinstated';

export type RecoveryApplication = {
  id: string;
  source: RecoverySource | string;
  amountCents: number;
  stripeRef: string | null;
  orderId: string | null;
  orderNumber: string | null;
  createdAt: string;
};

export type SellerRecovery = {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  disputeId: string | null;
  stripeDisputeId: string;
  disputeReason: string | null;
  amountCents: number;
  feeCents: number;
  heldCancelledCents: number;
  recoveredCents: number;
  forgivenCents: number;
  outstandingCents: number;
  status: RecoveryStatus;
  createdAt: string;
  recoveredAt: string | null;
  applications: RecoveryApplication[];
};

export type RecoveriesResponse = {
  recoveries: SellerRecovery[];
  recoveryOwedCents: number;
  payoutsPaused: boolean;
};

/** "−$42.10" for money owed, "$12.00" otherwise. */
export function signedBalance(cents: number): string {
  return cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents);
}

export function recoveryStatusLabel(status: RecoveryStatus): string {
  switch (status) {
    case 'open': return 'Recovering';
    case 'recovered': return 'Recovered';
    case 'written_off': return 'Waived';
    case 'reinstated': return 'Reversed';
    default: return status;
  }
}

export function applicationLabel(app: Pick<RecoveryApplication, 'source' | 'orderNumber'>): string {
  switch (app.source) {
    case 'transfer_reversal': return 'Pulled back from the order payout';
    case 'release_netting': return app.orderNumber ? `Kept from order #${app.orderNumber} payout` : 'Kept from an order payout';
    case 'payout_netting': return 'Kept from a payout';
    case 'manual': return 'Paid';
    case 'write_off': return 'Waived by Brandthread';
    case 'reinstated': return 'Chargeback reversed by the bank';
    default: return 'Applied';
  }
}

const REASONS: Record<string, string> = {
  fraudulent: 'Cardholder says they didn’t make the purchase',
  product_not_received: 'Buyer says the order didn’t arrive',
  product_unacceptable: 'Buyer says the item wasn’t as described',
  duplicate: 'Buyer says they were charged twice',
  credit_not_processed: 'Buyer says a refund wasn’t processed',
  unrecognized: 'Buyer doesn’t recognise the charge',
  subscription_canceled: 'Buyer says they cancelled',
  general: 'Buyer’s bank opened a dispute',
};

export function disputeReasonText(reason: string | null): string {
  return REASONS[reason ?? ''] ?? REASONS.general;
}

/** "$42.10 chargeback being recovered from upcoming payouts" for the paused row. */
export function pausedRowCaption(owedCents: number): string {
  return `${formatCents(owedCents)} chargeback being recovered from upcoming payouts`;
}

export function recoveryTitle(r: Pick<SellerRecovery, 'orderNumber'>): string {
  return r.orderNumber ? `Order #${r.orderNumber}` : 'Chargeback';
}
