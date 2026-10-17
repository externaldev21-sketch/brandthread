/**
 * Buyer-facing order number: "Order #10234" from the server's `BT-10234`
 * (or a bare number). Anything else (a UUID, an internal or synthetic
 * identifier) returns null so the UI shows the date alone and never prints a
 * raw ID.
 */
const ORDER_NUMBER = /^(?:[A-Za-z]+-)*0*(\d{1,10})$/;

export function orderDisplayNumber(orderNumber: string | null | undefined): string | null {
  const match = ORDER_NUMBER.exec((orderNumber ?? '').trim());
  if (!match) return null;
  return `Order #${match[1]}`;
}
