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
  /** e.g. "+$120.00 (8.2%) vs last period", "No change vs last period", "+4 vs last period" for a brand-new comparison base. */
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
  const diff = current - previous;
  const sign = diff > 0 ? '+' : '-';
  const amountText = formatValue(Math.abs(diff));
  if (change.percent == null) {
    return { direction: change.direction, label: `${sign}${amountText} vs ${periodLabel}` };
  }
  return {
    direction: change.direction,
    label: `${sign}${amountText} (${Math.abs(change.percent)}%) vs ${periodLabel}`,
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

/** Real return count from already-fetched order rows (`order.returns` is populated by the orders API). */
export function countOrderReturns(rows: any[]): number {
  return rows.filter((order) => Array.isArray(order.returns) && order.returns.length > 0).length;
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
  const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : [];
  return {
    id: String(order?.id ?? ''),
    buyerName: order?.customerName ?? order?.customer?.name ?? order?.buyerName ?? 'Unknown',
    itemCount: Number(order?.listItemCount ?? lineItems.length ?? 0),
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
