/**
 * Rules for buying a shipping label that covers only some of an order's
 * items (split shipments). Pure; the route loads the rows under the order lock.
 */
export type LabelableItem = {
  id: string;
  refundedAt: Date | null;
  deliveredAt: Date | null;
  trackingNumber: string | null;
};

export function parseItemIds(value: unknown): string[] | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !id)) return "invalid";
  return [...new Set(value as string[])];
}

/** Returns an error message, or null when these items can go on a new label. */
export function partialLabelItemError(
  items: LabelableItem[],
  itemsOnOpenLabels: string[],
  chosen: string[],
): string | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const open = new Set(itemsOnOpenLabels);
  for (const id of chosen) {
    const item = byId.get(id);
    if (!item) return "Choose items that belong to this order.";
    if (item.refundedAt || item.deliveredAt) return "An item you chose was already refunded or delivered.";
    if (item.trackingNumber) return "An item you chose already has tracking.";
    if (open.has(id)) return "An item you chose is already on another label.";
  }
  return null;
}
