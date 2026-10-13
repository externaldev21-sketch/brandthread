/**
 * Keeps the seller's iOS widgets ("Sales today", "To ship"; Home and Lock
 * Screen) current from GET /api/analytics/widget-summary. Called by
 * SystemSurfacesBridge on launch, on returning to the app and when a
 * new-order push arrives while the app runs. (With the app closed, the
 * notification service extension updates the same snapshot from the push.)
 *
 * Real numbers only: preview/demo sessions never write a snapshot, and an
 * error leaves the last real snapshot in place.
 */
import { api } from '@/lib/api';
import { clearSellerWidgets, updateSellerTodayWidget } from '@/lib/nativeSystem';

export type WidgetSummaryResponse = Awaited<ReturnType<typeof api.analytics.widgetSummary>>;

export function widgetSnapshotFromSummary(summary: WidgetSummaryResponse) {
  if (!summary.enabled) return null;
  const whole = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  return {
    salesCents: whole(summary.salesTodayCents),
    ordersCount: whole(summary.ordersToday),
    toShipCount: whole(summary.toShipCount),
    currency: summary.currency || 'USD',
  };
}

let inFlight: Promise<void> | null = null;

export function refreshSellerWidgets(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = api.analytics.widgetSummary()
    .then((summary) => {
      const snapshot = widgetSnapshotFromSummary(summary);
      if (snapshot) updateSellerTodayWidget(snapshot);
      else clearSellerWidgets();
    })
    .catch(() => {})
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Seller pushes that change the widget numbers. */
const REFRESH_TYPES = new Set(['new_order_received', 'order_cancelled_by_buyer', 'order_auto_refunded_seller']);

export function isWidgetRefreshPush(data: Record<string, unknown> | null | undefined): boolean {
  return typeof data?.type === 'string' && REFRESH_TYPES.has(data.type);
}
