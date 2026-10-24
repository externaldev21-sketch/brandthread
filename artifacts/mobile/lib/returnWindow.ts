/**
 * Buyer return window ("30-day return window · request by …").
 *
 * The window runs from delivery, not from the order date: an order that took
 * two weeks to arrive still gets 30 days with the item. Delivery comes from
 * the order's `delivery` block (GET /api/buyer/orders/:id): `deliveredAt`,
 * else the done "delivered" timeline step, else a "delivered" tracking event,
 * else the latest delivered shipment. Only when none is known does the window
 * fall back to the order date.
 *
 * Pure: `now` is injected so it is unit-tested (tests/return-window.test.ts).
 */

export const RETURN_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type DeliveryLike = {
  deliveredAt?: string | null;
  steps?: { key: string; state?: string; at: string | null }[] | null;
  events?: { status: string; at: string }[] | null;
  shipments?: { deliveredAt: string | null }[] | null;
} | null | undefined;

export interface ReturnWindowOrder {
  createdAt?: string | null;
  delivery?: DeliveryLike;
}

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** When the item was delivered, if the order says so (ms since epoch). */
export function deliveredAtMs(delivery: DeliveryLike): number | null {
  if (!delivery) return null;
  const direct = parse(delivery.deliveredAt);
  if (direct !== null) return direct;
  const step = (delivery.steps ?? []).find(s => s.key === 'delivered' && s.state === 'done');
  const fromStep = parse(step?.at);
  if (fromStep !== null) return fromStep;
  const event = (delivery.events ?? []).find(e => /^delivered$/i.test(e.status));
  const fromEvent = parse(event?.at);
  if (fromEvent !== null) return fromEvent;
  const shipped = (delivery.shipments ?? [])
    .map(s => parse(s.deliveredAt))
    .filter((t): t is number => t !== null);
  return shipped.length ? Math.max(...shipped) : null;
}

export interface ReturnWindow {
  /** ISO instant the window closes. */
  deadline: string;
  /** Whether the window started at delivery (true) or at the order date (fallback). */
  fromDelivery: boolean;
}

/**
 * The open return window, or null when no start date is known or the window
 * has already closed (the line is hidden then, never shown in the past).
 */
export function openReturnWindow(
  order: ReturnWindowOrder | null | undefined,
  now: number = Date.now(),
  days: number = RETURN_WINDOW_DAYS,
): ReturnWindow | null {
  if (!order) return null;
  const delivered = deliveredAtMs(order.delivery);
  const start = delivered ?? parse(order.createdAt);
  if (start === null) return null;
  const end = start + days * DAY_MS;
  if (end <= now) return null;
  return { deadline: new Date(end).toISOString(), fromDelivery: delivered !== null };
}
