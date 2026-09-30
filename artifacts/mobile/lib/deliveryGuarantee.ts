/**
 * Delivery guarantee helpers (docs/payments/delivery-guarantee.md).
 *
 * Pure functions only: the API's `delivery` block → what the buyer screens
 * show, the seller's `deliverBy` → a countdown, and pre-order ship-date
 * validation. Deadlines are absolute instants; only their *display* is
 * time-zone aware, always in the device's zone (an optional `timeZone` exists
 * so tests can pin one).
 */
import type { BuyerDelivery, DeliveryEvent, DeliveryStep, DeliveryStepKey } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Under this much time left the seller countdown turns into a warning. */
export const URGENT_WINDOW_MS = 2 * DAY;

export interface DateFormatOptions {
  /** IANA zone; omit for the device's own zone (the only thing the app passes). */
  timeZone?: string;
  /** BCP-47 locale; omit for the device's. */
  locale?: string;
}

function parseInstant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** "Oct 15, 2026" in the device's time zone. Empty string for an unparseable value. */
export function formatLocalDate(iso: string | null | undefined, opts: DateFormatOptions = {}): string {
  const ms = parseInstant(iso);
  if (ms === null) return '';
  return new Date(ms).toLocaleDateString(opts.locale, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: opts.timeZone,
  });
}

/** "Oct 15, 2026, 3:42 PM" in the device's time zone. */
export function formatLocalDateTime(iso: string | null | undefined, opts: DateFormatOptions = {}): string {
  const ms = parseInstant(iso);
  if (ms === null) return '';
  return new Date(ms).toLocaleString(opts.locale, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: opts.timeZone,
  });
}

/**
 * Carrier/seller estimates arrive as a date-only `YYYY-MM-DD`. Parsed as UTC
 * midnight that would slip a day west of Greenwich, so date-only values are
 * shown as the calendar date they name.
 */
export function formatCalendarDate(value: string | null | undefined, opts: DateFormatOptions = {}): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatLocalDate(`${value}T12:00:00Z`, { ...opts, timeZone: 'UTC' });
  return formatLocalDate(value, opts);
}

/** The quiet buyer line. Null when the order has no guarantee (pre-guarantee orders). */
export function guaranteeLine(deliverBy: string | null | undefined, opts: DateFormatOptions = {}): string | null {
  const date = formatLocalDate(deliverBy, opts);
  return date ? `Guaranteed delivery by ${date} or automatic refund` : null;
}

/** Seller banner copy for an order with unshipped items. */
export function sellerShipByLine(deliverBy: string | null | undefined, opts: DateFormatOptions = {}): string | null {
  const date = formatLocalDate(deliverBy, opts);
  return date ? `Ship and add tracking by ${date} or this order will be auto-refunded` : null;
}

// ─── Seller countdown ─────────────────────────────────────────────────────────

export type CountdownKind = 'left' | 'overdue' | 'refunded';

export interface DeadlineCountdown {
  kind: CountdownKind;
  label: string;
  /** Under two days, overdue or auto-refunded: render in the error colour. */
  urgent: boolean;
  msLeft: number;
}

/** "12d 4h left", "5h 12m left", "42m left". Whole days + hours above a day. */
export function formatTimeLeft(msLeft: number): string {
  const ms = Math.max(0, msLeft);
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    const hours = Math.floor((ms % DAY) / HOUR);
    return `${days}d ${hours}h left`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return `${hours}h ${minutes}m left`;
  }
  return `${Math.max(1, Math.floor(ms / MINUTE))}m left`;
}

/**
 * Countdown chip for an order the seller still has to ship. Null when there is
 * nothing to count down: no deadline (pre-guarantee order), already shipped, or
 * delivered. An open dispute still counts down; the auto-refund is paused
 * server-side but the seller should see how long is left.
 */
export function sellerCountdown(
  order: { deliverBy?: string | null; autoRefundedAt?: string | null; deliveredAt?: string | null },
  shipped: boolean,
  now: number = Date.now(),
): DeadlineCountdown | null {
  if (order.autoRefundedAt) return { kind: 'refunded', label: 'Auto-refunded', urgent: true, msLeft: 0 };
  if (shipped || order.deliveredAt) return null;
  const due = parseInstant(order.deliverBy);
  if (due === null) return null;
  const msLeft = due - now;
  if (msLeft <= 0) return { kind: 'overdue', label: 'Overdue', urgent: true, msLeft };
  return { kind: 'left', label: formatTimeLeft(msLeft), urgent: msLeft < URGENT_WINDOW_MS, msLeft };
}

// ─── Buyer delivery block ─────────────────────────────────────────────────────

export const DELIVERY_STEP_ORDER: readonly DeliveryStepKey[] = [
  'ordered', 'preparing', 'shipped', 'out_for_delivery', 'delivered',
];

const DEFAULT_STEP_LABELS: Record<DeliveryStepKey, string> = {
  ordered: 'Ordered',
  preparing: 'Preparing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

/**
 * Always five steps in canonical order. The API drives state/time; any step it
 * omitted is filled as upcoming so the tracker never renders a short list.
 * Anything unknown from a newer server is dropped.
 */
export function normalizeDeliverySteps(raw: unknown): DeliveryStep[] {
  const byKey = new Map<string, DeliveryStep>();
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (s && typeof s === 'object' && typeof (s as DeliveryStep).key === 'string') {
        byKey.set((s as DeliveryStep).key, s as DeliveryStep);
      }
    }
  }
  return DELIVERY_STEP_ORDER.map(key => {
    const step = byKey.get(key);
    const state = step?.state === 'done' || step?.state === 'current' ? step.state : 'upcoming';
    return {
      key,
      label: typeof step?.label === 'string' && step.label ? step.label : DEFAULT_STEP_LABELS[key],
      state,
      at: typeof step?.at === 'string' ? step.at : null,
    };
  });
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Defensive map of the API's `delivery` object; undefined when absent. */
export function mapDelivery(raw: unknown): BuyerDelivery | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, any>;
  const autoRefund = d.autoRefund && typeof d.autoRefund === 'object' && Number.isFinite(d.autoRefund.refundedCents)
    ? {
        refundedCents: Math.max(0, Math.round(d.autoRefund.refundedCents)),
        refundedAt: str(d.autoRefund.refundedAt) ?? '',
        partial: d.autoRefund.partial === true,
        label: str(d.autoRefund.label) ?? 'Refunded, not delivered in time',
      }
    : null;
  return {
    deliverBy: str(d.deliverBy),
    isPreorder: d.isPreorder === true,
    promisedShipDate: str(d.promisedShipDate),
    estimatedDelivery: str(d.estimatedDelivery),
    deliveredAt: str(d.deliveredAt),
    deliveryConfirmedBy: d.deliveryConfirmedBy === 'carrier' || d.deliveryConfirmedBy === 'buyer' ? d.deliveryConfirmedBy : null,
    steps: normalizeDeliverySteps(d.steps),
    events: (Array.isArray(d.events) ? d.events : [])
      .filter((e: any): e is DeliveryEvent => !!e && typeof e.at === 'string')
      .map((e: any) => ({
        status: String(e.status ?? ''),
        description: String(e.description ?? ''),
        location: str(e.location),
        at: e.at,
      })),
    carrier: str(d.carrier),
    trackingNumber: str(d.trackingNumber),
    trackingUrl: str(d.trackingUrl),
    canConfirmReceipt: d.canConfirmReceipt === true,
    disputePaused: d.disputePaused === true,
    autoRefund,
    shipments: (Array.isArray(d.shipments) ? d.shipments : [])
      .filter((s: any) => s && typeof s.trackingNumber === 'string')
      .map((s: any) => ({
        trackingNumber: s.trackingNumber,
        carrier: str(s.carrier),
        trackingStatus: str(s.trackingStatus),
        deliveredAt: str(s.deliveredAt),
        itemIds: Array.isArray(s.itemIds) ? s.itemIds.filter((i: unknown) => typeof i === 'string') : [],
      })),
  };
}

/** Only http(s) links are ever opened from a tracking URL. */
export function safeTrackingUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** "Refunded $42.00 to your original payment method" (+ partial wording). */
export function autoRefundSummary(autoRefund: NonNullable<BuyerDelivery['autoRefund']>, opts: DateFormatOptions = {}): string {
  const amount = formatCents(autoRefund.refundedCents);
  const when = formatLocalDate(autoRefund.refundedAt, opts);
  const base = autoRefund.partial
    ? `${amount} was refunded to your original payment method for the items that weren't delivered in time.`
    : `${amount} was refunded in full to your original payment method.`;
  return when ? `${base} Refunded ${when}.` : base;
}

export type HeadlineTone = 'neutral' | 'success' | 'muted';

export interface DeliveryHeadline {
  text: string;
  tone: HeadlineTone;
}

/**
 * The one-line status under an order in the Orders list: "Arriving Oct 15",
 * "Delivered Oct 12", "Refunded", "Seller ships by Nov 1". Null when there is
 * nothing useful to say yet (the status badge already covers it).
 */
export function deliveryHeadline(
  order: { status: string; delivery?: BuyerDelivery; estimatedDelivery?: string },
  opts: DateFormatOptions = {},
): DeliveryHeadline | null {
  const d = order.delivery;
  if (d?.autoRefund) return { text: d.autoRefund.partial ? 'Partially refunded, not delivered in time' : 'Refunded, not delivered in time', tone: 'muted' };
  if (order.status === 'refunded') return { text: 'Refunded', tone: 'muted' };
  if (order.status === 'cancelled') return null;
  if (order.status === 'delivered' || d?.deliveredAt) {
    const when = formatLocalDate(d?.deliveredAt, opts);
    return { text: when ? `Delivered ${when}` : 'Delivered', tone: 'success' };
  }
  const shipped = d ? d.steps.some(s => s.key === 'shipped' && s.state !== 'upcoming') : order.status === 'shipped';
  if (!shipped && d?.isPreorder && d.promisedShipDate) {
    return { text: `Seller ships by ${formatLocalDate(d.promisedShipDate, opts)}`, tone: 'neutral' };
  }
  const eta = d?.estimatedDelivery ?? order.estimatedDelivery;
  if (shipped && eta) {
    const out = d?.steps.find(s => s.key === 'out_for_delivery')?.state === 'current';
    return { text: out ? 'Out for delivery' : `Arriving ${formatCalendarDate(eta, opts)}`, tone: 'neutral' };
  }
  if (d?.deliverBy) return { text: `Arrives by ${formatLocalDate(d.deliverBy, opts)}`, tone: 'neutral' };
  return null;
}

// ─── Pre-order listing validation ─────────────────────────────────────────────

export const PREORDER_SHIP_DATE_REQUIRED_MESSAGE = 'Add the date you will ship pre-orders. Buyers are refunded automatically if it is late.';

/**
 * A pre-order listing needs a real, future ship date (API: 400
 * PREORDER_SHIP_DATE_REQUIRED). Returns the inline error, or null when fine
 * (including when pre-orders are off). `today` is the device's local date.
 */
export function preOrderShipDateError(
  isPreOrder: boolean,
  value: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!isPreOrder) return null;
  const v = (value ?? '').trim();
  if (!v) return 'Ship date is required for pre-orders.';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return 'Use the format YYYY-MM-DD.';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return 'That date does not exist.';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date.getTime() <= today.getTime()) return 'Ship date must be in the future.';
  return null;
}
