/**
 * "Held until delivery" copy for the payout screens, from GET /api/finance/summary
 * (held.amount, held.rule, held.orders). Pure, so the wording is unit-tested
 * against the server's release rules (api-server lib/delivery/policy.ts and
 * payoutTiming.ts): with PAYOUT_MODE=hold a seller is paid
 * PAYOUT_RELEASE_BUFFER_DAYS (default 3) after delivery, for regular orders
 * and pre-orders alike.
 */
import { formatCents } from './money';
import type { FinanceSummary, HeldOrderTiming, PayoutHoldRule } from './financeSummary';

const DAY_MS = 86_400_000;

/** What the server does when it doesn't say (older API): the policy.ts defaults. */
export const DEFAULT_PAYOUT_HOLD_RULE: PayoutHoldRule = {
  mode: 'hold',
  bufferDays: 3,
  regularDeliveryDays: 15,
  preorderDeliveryDays: 60,
};

export function holdRuleLine(rule: PayoutHoldRule = DEFAULT_PAYOUT_HOLD_RULE): string {
  if (rule.mode !== 'hold') return 'Pre-orders are paid when they ship';
  if (rule.bufferDays <= 0) return 'Paid when the order is delivered';
  return `Paid ${rule.bufferDays} ${rule.bufferDays === 1 ? 'day' : 'days'} after delivery`;
}

function shortDate(iso: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  try {
    return new Intl.DateTimeFormat('en-US', timeZone ? { ...options, timeZone } : options).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(new Date(iso));
  }
}

/** One line under an order: when its money is paid out. */
export function heldOrderStatusLine(order: HeldOrderTiming, now: Date = new Date(), timeZone?: string): string {
  switch (order.state) {
    case 'scheduled':
      if (!order.payoutReleaseAt || new Date(order.payoutReleaseAt).valueOf() <= now.valueOf()) return 'Paying out';
      return `Paid ${shortDate(order.payoutReleaseAt, timeZone)}`;
    case 'awaiting_delivery':
      return order.isPreorder ? 'Pre-order, waiting for delivery' : 'Waiting for delivery';
    case 'paused':
      return 'On hold while a return or chargeback is open';
    case 'on_ship':
      return order.isPreorder ? 'Pre-order, paid when it ships' : 'Paid when it ships';
    case 'processing':
    default:
      return 'Paying out';
  }
}

export type HeldForDeliveryView = {
  /** False when there is nothing to explain (no hold policy and nothing held). */
  visible: boolean;
  label: string;
  amount: string;
  rule: string;
  orders: { id: string; title: string; status: string; amount: string }[];
  moreCount: number;
  /** The soonest dated payout among held orders, e.g. "Next $42.50 on Oct 12", or null. */
  next: string | null;
};

function nextPayoutLine(orders: HeldOrderTiming[], now: Date, timeZone?: string): string | null {
  const dated = orders
    .filter((order) => order.state === 'scheduled' && order.payoutReleaseAt && new Date(order.payoutReleaseAt).valueOf() > now.valueOf())
    .sort((a, b) => new Date(a.payoutReleaseAt!).valueOf() - new Date(b.payoutReleaseAt!).valueOf());
  if (!dated.length) return null;
  const day = shortDate(dated[0].payoutReleaseAt!, timeZone);
  const cents = dated.filter((order) => shortDate(order.payoutReleaseAt!, timeZone) === day)
    .reduce((sum, order) => sum + order.netCents, 0);
  return `Next ${formatCents(cents)} on ${day}`;
}

export function buildHeldForDeliveryView(
  summary: Pick<FinanceSummary, 'held'> | null | undefined,
  options: { now?: Date; maxOrders?: number; timeZone?: string } = {},
): HeldForDeliveryView {
  const rule = summary?.held.rule ?? DEFAULT_PAYOUT_HOLD_RULE;
  const amountCents = summary?.held.amount ?? 0;
  const all = summary?.held.orders ?? [];
  const max = options.maxOrders ?? 3;
  const shown = all.slice(0, max);
  return {
    visible: rule.mode === 'hold' || amountCents > 0 || all.length > 0,
    label: rule.mode === 'hold' ? 'Held until delivery' : 'Held until shipped',
    amount: formatCents(amountCents),
    rule: holdRuleLine(rule),
    orders: shown.map((order) => ({
      id: order.orderId,
      title: `Order #${order.orderNumber.replace(/^#/, '')}`,
      status: heldOrderStatusLine(order, options.now, options.timeZone),
      amount: formatCents(order.netCents),
    })),
    moreCount: Math.max(0, all.length - shown.length),
    next: nextPayoutLine(all, options.now ?? new Date(), options.timeZone),
  };
}

/** Local-only illustration for the seller web preview with demo=1. */
export function previewHeldForDelivery(now: Date = new Date()): Pick<FinanceSummary, 'held'> {
  const orders: HeldOrderTiming[] = [
    { orderId: 'demo-held-1', orderNumber: 'BT-1042', isPreorder: false, netCents: 4_250, state: 'scheduled', deliverBy: null, payoutReleaseAt: new Date(now.valueOf() + 2 * DAY_MS).toISOString() },
    { orderId: 'demo-held-2', orderNumber: 'BT-1047', isPreorder: false, netCents: 6_800, state: 'awaiting_delivery', deliverBy: new Date(now.valueOf() + 9 * DAY_MS).toISOString(), payoutReleaseAt: null },
    { orderId: 'demo-held-3', orderNumber: 'BT-1051', isPreorder: true, netCents: 3_900, state: 'awaiting_delivery', deliverBy: new Date(now.valueOf() + 41 * DAY_MS).toISOString(), payoutReleaseAt: null },
  ];
  const amount = orders.reduce((sum, order) => sum + order.netCents, 0);
  return {
    held: { amount, formatted: formatCents(amount), drops: [], rule: DEFAULT_PAYOUT_HOLD_RULE, orders },
  };
}
