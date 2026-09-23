/**
 * View model for the seller's "where is my money" summary
 * (GET /api/finance/summary). Pure functions only, so the screen stays a thin
 * renderer and the wording is unit-tested.
 */
import { formatCents } from './money';

export type MoneyAmount = { amount: number; formatted: string };

export type DropEscrowState = 'collecting' | 'production' | 'fulfilling' | 'completed' | 'failing' | 'failed';

export type FinanceSummaryDrop = {
  dropId: string;
  name: string;
  escrowState: DropEscrowState | null;
  fulfillmentDeadlineAt: string | null;
  heldCents: number;
  shortfallCents: number;
  ordersHeld: number;
  ordersReleased: number;
  ordersRefunded: number;
};

export type FinanceSummary = {
  currency: string;
  connected: boolean;
  stripeError: boolean;
  held: MoneyAmount & { drops: FinanceSummaryDrop[] };
  releasing: MoneyAmount & { count: number };
  available: MoneyAmount | null;
  pending: MoneyAmount | null;
  paidOut: MoneyAmount & { toBank: MoneyAmount | null };
  owed: MoneyAmount;
  credit: MoneyAmount;
  lifetime: {
    grossSales: MoneyAmount;
    refunded: MoneyAmount;
    platformFees: MoneyAmount;
    processingFees: MoneyAmount;
  };
  activity: Array<{
    id: string;
    kind: string;
    description: string | null;
    orderId: string | null;
    dropId: string | null;
    occurredAt: string;
    sellerEffectCents: number;
  }>;
};

export type Tone = 'neutral' | 'positive' | 'caution' | 'negative';

export type MoneyTile = {
  key: 'held' | 'releasing' | 'available' | 'paidOut';
  label: string;
  value: string;
  caption: string;
  tone: Tone;
  icon: 'lock' | 'truck' | 'check-circle' | 'send';
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildMoneyTiles(summary: FinanceSummary): MoneyTile[] {
  const activeDrops = summary.held.drops.filter((d) => d.heldCents > 0).length;
  return [
    {
      key: 'held',
      label: 'Held',
      value: formatCents(summary.held.amount),
      caption: activeDrops > 0
        ? `${plural(activeDrops, 'preorder drop')} · paid per order as each ships`
        : 'Preorder money waiting to ship',
      tone: 'neutral',
      icon: 'lock',
    },
    {
      key: 'releasing',
      label: 'On the way',
      value: formatCents(summary.releasing.amount),
      caption: summary.releasing.count > 0
        ? `${plural(summary.releasing.count, 'shipped order')} being transferred`
        : 'Nothing in transit',
      tone: 'neutral',
      icon: 'truck',
    },
    {
      key: 'available',
      label: 'Available',
      value: summary.available ? formatCents(summary.available.amount) : '—',
      caption: !summary.connected
        ? 'Connect Stripe to get paid'
        : summary.stripeError || !summary.available
          ? "Couldn't reach Stripe"
          : summary.pending && summary.pending.amount > 0
            ? `${formatCents(summary.pending.amount)} still settling`
            : 'Ready to cash out',
      tone: summary.available && summary.available.amount > 0 ? 'positive' : 'neutral',
      icon: 'check-circle',
    },
    {
      key: 'paidOut',
      label: 'Paid out',
      value: formatCents(summary.paidOut.amount),
      caption: summary.paidOut.toBank
        ? `${formatCents(summary.paidOut.toBank.amount)} reached your bank`
        : 'Sent to your Stripe account',
      tone: 'neutral',
      icon: 'send',
    },
  ];
}

export function dropStateLabel(state: DropEscrowState | null): { label: string; tone: Tone } {
  switch (state) {
    case 'collecting': return { label: 'Taking preorders', tone: 'neutral' };
    case 'production': return { label: 'In production', tone: 'neutral' };
    case 'fulfilling': return { label: 'Shipping', tone: 'positive' };
    case 'completed': return { label: 'Complete', tone: 'positive' };
    case 'failing': return { label: 'Refunding buyers', tone: 'caution' };
    case 'failed': return { label: 'Refunded', tone: 'negative' };
    default: return { label: 'Not a preorder', tone: 'neutral' };
  }
}

/** "Ship by Oct 3" while the drop is open; nothing once it is finished. */
export function deadlineText(drop: Pick<FinanceSummaryDrop, 'escrowState' | 'fulfillmentDeadlineAt'>, now = new Date()): string | null {
  if (!drop.fulfillmentDeadlineAt) return null;
  if (drop.escrowState !== 'collecting' && drop.escrowState !== 'production' && drop.escrowState !== 'fulfilling') return null;
  const deadline = new Date(drop.fulfillmentDeadlineAt);
  if (Number.isNaN(deadline.valueOf())) return null;
  if (deadline.valueOf() <= now.valueOf()) return 'Deadline passed — unshipped orders are being refunded';
  const days = Math.ceil((deadline.valueOf() - now.valueOf()) / 86_400_000);
  const date = deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return days <= 7 ? `Ship by ${date} (${plural(days, 'day')} left)` : `Ship by ${date}`;
}

export function dropOrdersText(drop: Pick<FinanceSummaryDrop, 'ordersHeld' | 'ordersReleased' | 'ordersRefunded'>): string {
  const parts: string[] = [];
  if (drop.ordersHeld) parts.push(`${drop.ordersHeld} waiting to ship`);
  if (drop.ordersReleased) parts.push(`${drop.ordersReleased} paid out`);
  if (drop.ordersRefunded) parts.push(`${drop.ordersRefunded} refunded`);
  return parts.length ? parts.join(' · ') : 'No orders yet';
}

const ACTIVITY_LABELS: Record<string, string> = {
  order_paid_held: 'Preorder paid — held',
  order_paid_direct: 'Order paid',
  order_released: 'Released for a shipped order',
  label_paid_from_held: 'Shipping label (from held funds)',
  label_advanced: 'Shipping label',
  label_cost_recovered: 'Shipping label charged',
  label_void_to_held: 'Voided label returned',
  label_void_advanced: 'Voided label credited',
  bulk_paid_from_held: 'Bulk order paid from held funds',
  bulk_payment_reversed: 'Bulk payment returned',
  bulk_cost_allocated: 'Bulk cost for a shipped order',
  refund_buyer_cancelled: 'Refund — buyer cancelled',
  refund_seller_cancelled: 'Refund — you cancelled',
  refund_return_approved: 'Refund — return approved',
  refund_drop_failed: 'Refund — preorder not fulfilled',
  refund_oversold: 'Refund — sold out',
  refund_stripe_dashboard: 'Refund issued in Stripe',
  refund_failed_after_success: 'Refund failed — money returned',
  manufacturer_card_paid: 'Manufacturer card paid',
  legacy_opening: 'Opening balance',
  legacy_release: 'Earlier release',
  legacy_bulk_payment: 'Earlier bulk payment',
  legacy_label: 'Earlier shipping label',
};

export function activityLabel(kind: string, description: string | null): string {
  return ACTIVITY_LABELS[kind] ?? description ?? 'Money movement';
}

/** Signed amount for an activity row: "+$12.00", "−$3.50", or "—" when nothing reached the seller. */
export function signedCents(cents: number): string {
  if (cents === 0) return '—';
  return cents > 0 ? `+${formatCents(cents)}` : `−${formatCents(-cents)}`;
}

/** True when the summary has nothing to show yet (brand-new seller). */
export function isEmptySummary(summary: FinanceSummary): boolean {
  return summary.held.amount === 0
    && summary.releasing.amount === 0
    && summary.paidOut.amount === 0
    && summary.owed.amount === 0
    && summary.held.drops.length === 0
    && summary.activity.length === 0;
}
