/**
 * Seller order fulfilment (order detail "Fulfill item" sheet, batch ship).
 *
 * Pure helpers: which lines can still ship, how the sheet's per-line
 * selection becomes ONE request, and how a shipped order's items group into
 * shipments for the fulfilled layout. The server owns the rules (a
 * pre-order or a delivery-guaranteed order only ships with tracking, a
 * partial shipment always carries its own tracking number); this file only
 * refuses early what the server would refuse anyway, with the same reason.
 */

/** The carriers the manual-tracking flows offer (fulfil sheet + fulfillment wizard). */
export const SHIPPING_CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Other'] as const;

export interface FulfillLine {
  id: string;
  quantity: number;
  trackingNumber?: string | null;
  carrier?: string | null;
  refundedAt?: string | null;
}

export interface FulfillOrderFacts {
  /** UI order status (services/orderTypes OrderStatus). */
  status: string;
  isPreOrder: boolean;
  deliverBy?: string | null;
  autoRefundedAt?: string | null;
  lineItems: FulfillLine[];
}

const SHIPPED_STATUSES = new Set(['shipped', 'delivered']);
const CLOSED_STATUSES = new Set(['cancelled', 'refunded']);

/** Lines the seller can still ship. None once the order itself is shipped, closed or auto-refunded. */
export function linesToFulfill<T extends FulfillLine>(order: FulfillOrderFacts & { lineItems: T[] }): T[] {
  if (order.autoRefundedAt || SHIPPED_STATUSES.has(order.status) || CLOSED_STATUSES.has(order.status)) return [];
  return (order.lineItems as T[]).filter(li => !li.trackingNumber && !li.refundedAt);
}

export function canFulfill(order: FulfillOrderFacts): boolean {
  return linesToFulfill(order).length > 0;
}

/** The server refuses to ship these without a tracking number. */
export function trackingRequired(order: Pick<FulfillOrderFacts, 'isPreOrder' | 'deliverBy'>): boolean {
  return order.isPreOrder || !!order.deliverBy;
}

/** Every fulfillable line starts fully selected (Shopify's default). */
export function initialSelection(lines: FulfillLine[]): Record<string, number> {
  return Object.fromEntries(lines.map(li => [li.id, li.quantity]));
}

/**
 * A shipment always covers whole lines (the server ships an order item, not
 * part of one), so the stepper moves between 0 and the line's quantity:
 * any step down unselects the line, any step up selects all of it.
 */
export function stepSelection(current: number, next: number, quantity: number): number {
  if (next === current) return current;
  return next < current ? 0 : quantity;
}

export function selectedCount(lines: FulfillLine[], selection: Record<string, number>): number {
  return lines.reduce((sum, li) => sum + ((selection[li.id] ?? 0) >= li.quantity ? li.quantity : 0), 0);
}

export interface FulfillForm {
  trackingNumber: string;
  carrier: string;
  notifyCustomer: boolean;
}

export type FulfillRequest =
  /** Whole order with tracking: PATCH /:id/tracking (marks it shipped). */
  | { kind: 'order-tracking'; body: { trackingNumber: string; carrier?: string; notifyCustomer?: false } }
  /** Whole order without tracking: PATCH /:id/status shipped. */
  | { kind: 'order-status'; notifyCustomer: boolean }
  /** Some items: PATCH /:id/items-tracking. */
  | { kind: 'items'; body: { itemIds: string[]; trackingNumber: string; carrier?: string; notifyCustomer?: false } };

export type BuildResult = { ok: true; request: FulfillRequest } | { ok: false; error: string };

/** Turns the sheet's state into one request, or the reason it can't be sent. */
export function buildFulfillRequest(
  order: FulfillOrderFacts,
  selection: Record<string, number>,
  form: FulfillForm,
): BuildResult {
  const lines = linesToFulfill(order);
  const chosen = lines.filter(li => (selection[li.id] ?? 0) >= li.quantity);
  if (chosen.length === 0) return { ok: false, error: 'Select at least one item to fulfill.' };
  const trackingNumber = form.trackingNumber.trim();
  if (trackingNumber.length > 100) return { ok: false, error: 'Tracking numbers are at most 100 characters.' };
  const carrier = form.carrier.trim();
  const quiet = form.notifyCustomer ? {} : { notifyCustomer: false as const };
  const everyLine = order.lineItems.filter(li => !li.refundedAt);
  const wholeOrder = chosen.length === everyLine.length;
  if (wholeOrder) {
    if (trackingNumber) {
      return { ok: true, request: { kind: 'order-tracking', body: { trackingNumber, ...(carrier ? { carrier } : {}), ...quiet } } };
    }
    if (trackingRequired(order)) {
      return { ok: false, error: order.isPreOrder
        ? 'Add a tracking number to ship a pre-order. That is what releases its funds.'
        : 'Add a tracking number to ship this order. The carrier’s delivery scan completes it.' };
    }
    return { ok: true, request: { kind: 'order-status', notifyCustomer: form.notifyCustomer } };
  }
  if (!trackingNumber) return { ok: false, error: 'Add a tracking number to ship some of the items.' };
  return {
    ok: true,
    request: { kind: 'items', body: { itemIds: chosen.map(li => li.id), trackingNumber, ...(carrier ? { carrier } : {}), ...quiet } },
  };
}

export interface FulfillApi {
  addTracking: (id: string, body: unknown) => Promise<unknown>;
  addItemsTracking: (id: string, body: { itemIds: string[]; trackingNumber: string; carrier?: string; notifyCustomer?: false }) => Promise<unknown>;
  updateStatus: (id: string, status: string, opts?: { reason?: string; notes?: string; notifyCustomer?: false }) => Promise<unknown>;
}

/** Sends a built request with the existing order endpoints. */
export async function submitFulfillRequest(api: FulfillApi, orderId: string, request: FulfillRequest): Promise<void> {
  switch (request.kind) {
    case 'order-tracking':
      await api.addTracking(orderId, request.body);
      return;
    case 'items':
      await api.addItemsTracking(orderId, request.body);
      return;
    case 'order-status':
      await api.updateStatus(orderId, 'shipped', request.notifyCustomer ? undefined : { notifyCustomer: false });
      return;
  }
}

export interface ShipmentGroup<T extends FulfillLine> {
  key: string;
  trackingNumber: string | null;
  carrier: string | null;
  items: T[];
  quantity: number;
}

/**
 * Shipped items grouped by their tracking number, in order. A shipped order
 * without item-level tracking is one shipment with the order's own tracking.
 */
export function shipmentGroups<T extends FulfillLine>(
  order: FulfillOrderFacts & { lineItems: T[]; trackingNumber?: string | null; carrier?: string | null },
): ShipmentGroup<T>[] {
  const shippedOrder = SHIPPED_STATUSES.has(order.status);
  const groups: ShipmentGroup<T>[] = [];
  const byKey = new Map<string, ShipmentGroup<T>>();
  for (const li of order.lineItems) {
    if (li.refundedAt && !li.trackingNumber) continue;
    const tracking = li.trackingNumber ?? (shippedOrder ? order.trackingNumber ?? null : null);
    if (!tracking && !shippedOrder) continue;
    const key = tracking ?? 'order';
    let group = byKey.get(key);
    if (!group) {
      group = { key, trackingNumber: tracking, carrier: li.carrier ?? order.carrier ?? null, items: [], quantity: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(li);
    group.quantity += li.quantity;
  }
  return groups;
}

/** "#1001" — order numbers are stored without the hash. */
export function orderTitle(orderNumber: string | null | undefined): string {
  const n = (orderNumber ?? '').trim();
  if (!n) return 'Order';
  return n.startsWith('#') ? n : `#${n}`;
}

type RawItem = { id: string; trackingNumber?: string | null; carrier?: string | null; refundedAt?: string | null; shippedAt?: string | null };
type RawOrder = { status?: string; trackingNumber?: string | null; carrier?: string | null; shippedAt?: string | null; refundedCents?: number; totalCents?: number; items?: RawItem[] };

/**
 * What the server does for each request, applied to a raw order row. Only
 * for the seller web preview's on-device demo orders (`&demo=1`), which
 * never reach the API; real orders are always re-read from the server.
 */
export function applyFulfillLocally<T extends RawOrder>(raw: T, request: FulfillRequest, nowIso: string): T {
  const items = (raw.items ?? []).map(item => ({ ...item }));
  const shipItem = (item: RawItem, trackingNumber: string | null, carrier: string | null) => {
    if (item.refundedAt || item.trackingNumber) return;
    item.trackingNumber = trackingNumber;
    item.carrier = carrier;
    item.shippedAt = nowIso;
  };
  if (request.kind === 'items') {
    const ids = new Set(request.body.itemIds);
    for (const item of items) if (ids.has(item.id)) shipItem(item, request.body.trackingNumber, request.body.carrier ?? null);
    const allShipped = items.every(item => item.refundedAt || item.trackingNumber);
    return { ...raw, items, ...(allShipped ? { status: 'shipped', shippedAt: nowIso } : {}) };
  }
  const trackingNumber = request.kind === 'order-tracking' ? request.body.trackingNumber : null;
  const carrier = request.kind === 'order-tracking' ? request.body.carrier ?? null : null;
  if (trackingNumber) for (const item of items) shipItem(item, trackingNumber, carrier);
  return {
    ...raw, items, status: 'shipped', shippedAt: nowIso,
    ...(trackingNumber ? { trackingNumber, carrier } : {}),
  };
}

/** The preview twin of POST /:id/refund: adds the amount to what was refunded. */
export function applyRefundLocally<T extends RawOrder>(raw: T, amountCents: number): T {
  return { ...raw, refundedCents: (raw.refundedCents ?? 0) + amountCents };
}

/** What is left to refund on a raw order row (the server's own formula for legacy rows). */
export function refundableCentsOf(raw: { totalCents?: number; grossChargedCents?: number; refundedCents?: number }): number {
  const gross = (raw.grossChargedCents ?? 0) > 0 ? raw.grossChargedCents! : raw.totalCents ?? 0;
  return Math.max(0, gross - (raw.refundedCents ?? 0));
}
