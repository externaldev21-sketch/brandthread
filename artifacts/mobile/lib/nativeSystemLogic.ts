/**
 * Pure rules behind the iOS system surfaces (lib/nativeSystem.ts): which
 * orders get a Live Activity and what it shows, the quick actions per role,
 * and the actionable-notification categories. No react-native imports, so
 * it is unit-tested directly.
 */

export type OrderStage = 'ordered' | 'shipped' | 'out_for_delivery' | 'delivered';

export interface OrderActivityState {
  stage: OrderStage;
  statusText: string;
  /** Seconds since 1970, or null when there's no estimate. */
  etaEpoch: number | null;
}

/** The slice of a buyer order this needs (BuyerOrderView fits it). */
export interface TrackableOrder {
  id: string;
  orderNumber: string;
  sellerName: string;
  status: string;
  trackingStatus?: string | null;
  estimatedDelivery?: string | null;
  lineItems?: { imageUri?: string | null }[];
  delivery?: {
    deliveredAt?: string | null;
    estimatedDelivery?: string | null;
    autoRefund?: unknown;
    steps?: { key: string; state: string }[];
  } | null;
}

const STATUS_TEXT: Record<OrderStage, string> = {
  ordered: 'Order placed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

/** ISO date or instant → seconds since 1970. A date-only value (no time)
 *  is read as the end of that day, so "Arriving Oct 15" never shows a time
 *  that has already passed. */
export function etaToEpoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = Date.parse(dateOnly ? `${value}T23:59:00` : value);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/**
 * What the order's Live Activity should show, or null when it shouldn't
 * have one (not shipped yet, cancelled, refunded, disputed).
 */
export function orderActivityState(order: TrackableOrder): OrderActivityState | null {
  const d = order.delivery ?? undefined;
  if (d?.autoRefund) return null;
  if (order.status === 'cancelled' || order.status === 'refunded' || order.status === 'disputed') return null;
  const eta = etaToEpoch(d?.estimatedDelivery ?? order.estimatedDelivery ?? null);
  if (order.status === 'delivered' || d?.deliveredAt || order.trackingStatus === 'delivered') {
    return { stage: 'delivered', statusText: STATUS_TEXT.delivered, etaEpoch: null };
  }
  const outStep = d?.steps?.find((s) => s.key === 'out_for_delivery');
  if (order.trackingStatus === 'out_for_delivery' || outStep?.state === 'current') {
    return { stage: 'out_for_delivery', statusText: STATUS_TEXT.out_for_delivery, etaEpoch: eta };
  }
  const shippedStep = d?.steps?.find((s) => s.key === 'shipped');
  const shipped = order.status === 'shipped'
    || order.trackingStatus === 'in_transit'
    || order.trackingStatus === 'accepted'
    || (shippedStep ? shippedStep.state !== 'upcoming' : false);
  if (shipped) return { stage: 'shipped', statusText: STATUS_TEXT.shipped, etaEpoch: eta };
  return null;
}

/** iOS shows only a handful of Live Activities; Uber Eats / Amazon run one
 *  per active delivery. Cap ours so a busy buyer isn't flooded. */
export const MAX_ORDER_ACTIVITIES = 3;

export type OrderActivityPlan =
  | { kind: 'start'; order: TrackableOrder; state: OrderActivityState }
  | { kind: 'end'; orderId: string; state: OrderActivityState };

/**
 * Decides which activities to start/update and which to end, given the
 * buyer's orders and the ids of activities already running on the device.
 */
export function planOrderActivities(orders: TrackableOrder[], activeIds: string[]): OrderActivityPlan[] {
  const plans: OrderActivityPlan[] = [];
  const active = new Set(activeIds);
  // Running activities always keep updating; the cap only limits new ones.
  let started = 0;
  for (const order of orders) {
    const state = orderActivityState(order);
    if (state && state.stage !== 'delivered') {
      if (active.has(order.id)) {
        plans.push({ kind: 'start', order, state });
      } else if (started < MAX_ORDER_ACTIVITIES) {
        plans.push({ kind: 'start', order, state });
        started += 1;
      }
      continue;
    }
    if (active.has(order.id)) {
      plans.push({
        kind: 'end',
        orderId: order.id,
        state: state ?? { stage: 'ordered', statusText: 'Order updated', etaEpoch: null },
      });
    }
  }
  return plans;
}

// ─── Quick actions (long-press the app icon) ──────────────────────────────────

export interface QuickAction {
  type: string;
  title: string;
  /** SF Symbol name. */
  symbol: string;
  route: string;
}

/** Dev's four: New post, Add product, Orders, Search — per role, the ones
 *  that exist for that account. */
export function quickActionsFor(role: 'seller' | 'buyer' | null): QuickAction[] {
  if (role === 'seller') {
    return [
      { type: 'new-post', title: 'New post', symbol: 'plus.square', route: '/create-post' },
      { type: 'add-product', title: 'Add product', symbol: 'shippingbox', route: '/add-product' },
      { type: 'orders', title: 'Orders', symbol: 'bag', route: '/orders' },
      { type: 'search', title: 'Search', symbol: 'magnifyingglass', route: '/buyer-search' },
    ];
  }
  if (role === 'buyer') {
    return [
      { type: 'new-post', title: 'New post', symbol: 'plus.square', route: '/create-post' },
      { type: 'orders', title: 'Orders', symbol: 'bag', route: '/(buyer)/orders' },
      { type: 'search', title: 'Search', symbol: 'magnifyingglass', route: '/buyer-search' },
    ];
  }
  return [];
}

export function routeForQuickAction(type: string, role: 'seller' | 'buyer' | null): string | null {
  return quickActionsFor(role).find((a) => a.type === type)?.route ?? null;
}

// ─── Actionable notifications ─────────────────────────────────────────────────

/** Must match the API's NOTIFICATION_CATEGORY ids (src/lib/notificationCategories.ts). */
export const NOTIFICATION_CATEGORY = { DM_REPLY: 'dm_reply', NEW_ORDER: 'new_order' } as const;
export const NOTIFICATION_ACTION = { REPLY: 'reply', MARK_SHIPPED: 'mark_shipped' } as const;

export type NotificationActionPlan =
  | { kind: 'send-reply'; conversationId: string; text: string }
  | { kind: 'open'; route: string }
  | { kind: 'none' };

/** What a tap on a notification action should do. */
export function planNotificationAction(input: {
  actionIdentifier: string;
  userText?: string | null;
  data?: Record<string, unknown> | null;
}): NotificationActionPlan {
  const data = input.data ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (input.actionIdentifier === NOTIFICATION_ACTION.REPLY) {
    const conversationId = str(data.conversationId);
    const text = str(input.userText);
    return conversationId && text ? { kind: 'send-reply', conversationId, text } : { kind: 'none' };
  }
  if (input.actionIdentifier === NOTIFICATION_ACTION.MARK_SHIPPED) {
    const orderId = str(data.orderId);
    return orderId ? { kind: 'open', route: `/fulfill-order?orderId=${encodeURIComponent(orderId)}` } : { kind: 'none' };
  }
  return { kind: 'none' };
}
