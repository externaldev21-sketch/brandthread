/**
 * New-order push copy that reads well on Apple Watch (and the iPhone Lock
 * Screen): the Watch shows a short title and two or three lines of body, so
 * the amount goes in the title and the product in the body:
 *
 *   New order · $98
 *   Desires Tee and 1 more
 *
 * Only used while the `nativeSurfaces` flag is on; the in-app feed row keeps
 * its own copy. The push also carries `widgetDelta`, which the iOS
 * notification service extension adds to the seller's widget snapshot so
 * "Sales today" / "To ship" move even when the app is closed.
 */

/** "$98", "$98.50", "$1,240": no ".00", tabular-friendly. */
export function formatPushAmount(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
  const whole = safe % 100 === 0;
  return `$${(safe / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

export function newOrderPushTitle(totalCents: number): string {
  return `New order · ${formatPushAmount(totalCents)}`;
}

const MAX_PRODUCT_NAME = 40;

export function newOrderPushBody(input: { productName?: string | null; itemCount: number; orderNumber: string }): string {
  const name = input.productName?.trim();
  if (!name) return input.orderNumber;
  const short = name.length > MAX_PRODUCT_NAME ? `${name.slice(0, MAX_PRODUCT_NAME - 1).trimEnd()}…` : name;
  const more = Math.max(0, input.itemCount - 1);
  return more > 0 ? `${short} and ${more} more` : short;
}

export interface WidgetDelta {
  salesCents: number;
  orders: 1;
  toShip: 1;
}

export function newOrderWidgetDelta(totalCents: number): WidgetDelta {
  return { salesCents: Number.isFinite(totalCents) ? Math.max(0, Math.round(totalCents)) : 0, orders: 1, toShip: 1 };
}

/**
 * The push-only fields for a seller's new-order notification, or {} while
 * the `nativeSurfaces` flag is off (the push then keeps the feed copy).
 */
export async function salePingPushFields(
  input: { totalCents: number; productName?: string | null; itemCount: number; orderNumber: string },
  enabled: () => Promise<boolean> = async () => (await import("./nativeSurfaces")).isNativeSurfacesEnabled(),
): Promise<{ pushTitle?: string; pushBody?: string; pushData?: Record<string, unknown> }> {
  if (!(await enabled().catch(() => false))) return {};
  return {
    pushTitle: newOrderPushTitle(input.totalCents),
    pushBody: newOrderPushBody(input),
    pushData: { widgetDelta: newOrderWidgetDelta(input.totalCents) },
  };
}
