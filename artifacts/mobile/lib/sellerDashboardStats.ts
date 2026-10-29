export function deriveOrderStats(rows: any[]) {
  return {
    newOrders: rows.filter((order) => order.status === 'new' || order.status === 'pending').length,
    toProcess: rows.filter((order) => order.status === 'processing').length,
    // The production orders API uses "fulfilled" for packed orders awaiting shipment.
    readyToShip: rows.filter((order) => order.status === 'ready_to_ship' || order.status === 'fulfilled').length,
  };
}

export function deriveInventoryStats(rows: any[]) {
  return {
    lowStockCount: rows.filter((item) => {
      const stock = Number(item.stock ?? item.onHand ?? item.available ?? 0);
      const threshold = Number(item.lowStockThreshold ?? 0);
      return stock > 0 && stock <= threshold;
    }).length,
    outOfStockCount: rows.filter((item) => Number(item.stock ?? item.onHand ?? item.available ?? 0) <= 0).length,
    incomingCount: rows.filter((item) => Number(item.incoming ?? 0) > 0).length,
    delayedCount: rows.filter((item) => item.incomingStatus === 'delayed' || item.status === 'delayed').length,
  };
}

export function deriveHubStats(quotes: any[], samples: any[], threads: any[]) {
  return {
    activeQuotes: quotes.filter((quote) => !['declined', 'cancelled', 'accepted'].includes(String(quote.status))).length,
    samplesNeedingReview: samples.filter((sample) => sample.status === 'review_needed' || sample.status === 'delivered').length,
    activeProduction: samples.filter((sample) =>
      ['processing', 'cut_and_sew', 'packing'].includes(String(sample.status)),
    ).length,
    unreadMessages: threads.reduce((total, thread) => total + Number(thread.unreadCount ?? 0), 0),
  };
}

// ─── Seller Dashboard rebuild: pure selectors on top of real API data ──────
//
// Everything below is display-only derivation of numbers the API already
// returns (home analytics, orders, inventory, products) — no money/payout
// calculation, no fabricated values. Kept in this file per the "extend, don't
// fork" data hook so every dashboard number stays traceable to one place.

import { computeMetricChange, type MetricChange } from './sellerMetricChange';

export interface DashboardDeltaLine {
  direction: MetricChange['direction'];
  /** e.g. "$120.00 (8.2%) vs last period", "No change vs last period", "4 vs last period" for a brand-new comparison base (unsigned; `direction` carries the sign). */
  label: string;
}

/**
 * A human delta line for a hero/tile number: real amount + real percent,
 * computed from the metric's current and previous-period values (both
 * already fetched, never invented here). Renders as neutral/"No change" text
 * for a zero delta so the UI can style it grey instead of implying up/down.
 */
export function describeDashboardDelta(
  current: number,
  previous: number,
  formatValue: (n: number) => string,
  periodLabel = 'last period',
): DashboardDeltaLine {
  const change = computeMetricChange(current, previous);
  if (change.direction === 'flat') {
    return { direction: 'flat', label: `No change vs ${periodLabel}` };
  }
  // Unsigned: the caller draws the ↑/↓ arrow, so a "+"/"-" would say the
  // direction twice ("↑ +$31.54").
  const amountText = formatValue(Math.abs(current - previous));
  if (change.percent == null) {
    return { direction: change.direction, label: `${amountText} vs ${periodLabel}` };
  }
  return {
    direction: change.direction,
    label: `${amountText} (${Math.abs(change.percent)}%) vs ${periodLabel}`,
  };
}

export interface DashboardActionCounts {
  toShip: number;
  toAnswer: number;
  lowStock: number;
  returns: number;
}

/** True when there is nothing to review — the section should collapse to "You're all caught up". */
export function hasNoActionNeeded(counts: DashboardActionCounts): boolean {
  return counts.toShip <= 0 && counts.toAnswer <= 0 && counts.lowStock <= 0 && counts.returns <= 0;
}

/**
 * "N returns to review": buyer return requests still awaiting the seller's
 * decision (GET /api/returns, status 'pending'). This used to count
 * `order.returns` on GET /api/orders rows, a field that endpoint never sends,
 * so the tile was always 0.
 */
export function countPendingReturns(rows: any[]): number {
  return rows.filter((row) => row?.status === 'pending').length;
}

/**
 * Unread buyer messages, by the seller inbox's own rule (MessagesInbox's
 * header count): buyer↔seller threads only, requests and archived excluded,
 * summing each thread's unreadCount.
 */
export function countUnreadBuyerMessages(conversations: any[]): number {
  return conversations.reduce((sum, c) => (
    !c || c.type === 'buyer_to_buyer' || c.isRequest || c.isArchived ? sum : sum + Math.max(0, Number(c.unreadCount ?? 0) || 0)
  ), 0);
}

/** Paid, non-cancelled orders: the same orders the sales hero and Top products count. */
export function countSoldOrders(orders: any[]): number {
  return orders.filter((o) => (o?.paidAt ?? o?.paid_at) && o?.status !== 'cancelled').length;
}

/**
 * Everything below the hero that comes from orders/products/inbox, from one
 * set of source responses (lib/sellerDashboardSource.ts), for real sellers
 * and the preview alike. `toShip` is passed in: it reuses the Orders
 * screen's own Unfulfilled filter (see SellerHomeCommerceDashboard.tsx).
 */
export function deriveDashboardSecondary(input: {
  orders: any[];
  toShip: number;
  productAnalytics: any[];
  catalog: Array<{ id?: string; images?: unknown }>;
  lowStockCount: number;
  returns: any[];
  conversations: any[];
  quotes: any[];
  samples: any[];
  threads: any[];
}): {
  everSoldCount: number;
  recentOrders: RecentOrderSummary[];
  topProducts: TopProductSummary[];
  actionInputs: { unreadMessages: number; lowStockCount: number; returns: number; toShip: number };
} {
  const hub = deriveHubStats(input.quotes, input.samples, input.threads);
  const top = input.productAnalytics
    .filter((p) => Number(p?.revenueCents ?? 0) > 0)
    .map((p) => ({
      productId: String(p.productId),
      name: String(p.name ?? 'Untitled product'),
      unitsSold: Number(p.unitsSold ?? 0),
      revenueCents: Number(p.revenueCents ?? 0),
    }));
  return {
    everSoldCount: countSoldOrders(input.orders),
    recentOrders: input.orders.slice(0, 5).map(normalizeRecentOrder),
    topProducts: mergeTopProductImages(top, input.catalog).slice(0, 5),
    actionInputs: {
      // Buyers and manufacturers, as the To do row says ("Buyers and manufacturers waiting on you").
      unreadMessages: hub.unreadMessages + countUnreadBuyerMessages(input.conversations),
      lowStockCount: input.lowStockCount,
      returns: countPendingReturns(input.returns),
      toShip: input.toShip,
    },
  };
}

export interface TopProductSummary {
  productId: string;
  name: string;
  unitsSold: number;
  revenueCents: number;
  imageUrl: string | null;
}

/** Attaches a real product thumbnail (first image) from the product catalog to each analytics/products row, by id. Never fabricates an image. */
export function mergeTopProductImages(
  products: Array<{ productId: string; name: string; unitsSold: number; revenueCents: number }>,
  catalog: Array<{ id?: string; images?: unknown }>,
): TopProductSummary[] {
  const imageById = new Map<string, string | null>();
  for (const item of catalog) {
    if (!item?.id) continue;
    const images = Array.isArray(item.images) ? item.images : [];
    imageById.set(item.id, typeof images[0] === 'string' ? images[0] : null);
  }
  return products.map((product) => ({
    ...product,
    imageUrl: imageById.get(product.productId) ?? null,
  }));
}

export interface RecentOrderSummary {
  id: string;
  buyerName: string;
  itemCount: number;
  totalCents: number;
  status: string;
  orderNumber: string;
}

/** Normalizes one order row from `api.orders.list()` for the Recent Orders list — same fallback fields the rest of the app already reads. */
export function normalizeRecentOrder(order: any): RecentOrderSummary {
  const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : Array.isArray(order?.items) ? order.items : [];
  // GET /api/orders returns a server-side `itemCount`; fall back to the line items only when it's absent.
  return {
    id: String(order?.id ?? ''),
    buyerName: order?.customerName ?? order?.customer?.name ?? order?.buyerName ?? 'Unknown',
    itemCount: Number(order?.itemCount ?? order?.listItemCount ?? lineItems.length),
    totalCents: typeof order?.totalCents === 'number' ? order.totalCents : Number(order?.total_cents ?? 0),
    status: String(order?.status ?? 'unknown'),
    orderNumber: order?.orderNumber ?? order?.order_number ?? `#${String(order?.id ?? '').slice(-6).toUpperCase()}`,
  };
}

/**
 * A brand-new seller (never sold anything) gets the empty/setup state instead
 * of zeroed-out real sections — driven only by real totals, never assumed.
 */
export function isNewSeller(totalOrdersEver: number): boolean {
  return totalOrdersEver <= 0;
}
