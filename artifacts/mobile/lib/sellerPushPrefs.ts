/**
 * Seller "Push notifications" screen rows. Every toggle maps to a real
 * server-side category in /api/notification-prefs that lib/push.ts checks
 * before sending (preferenceKey), so a toggle that is off really stops
 * that push.
 */
export interface SellerPushRow {
  /** Server category key (notification-prefs SELLER_DEFAULTS). */
  key: string;
  label: string;
  description?: string;
}

export interface SellerPushGroup {
  title: string;
  subtitle?: string;
  rows: SellerPushRow[];
}

export const SELLER_PUSH_GROUPS: SellerPushGroup[] = [
  {
    title: 'Orders',
    rows: [
      { key: 'new_orders', label: 'New orders & fulfillments', description: 'New orders and fulfillment updates' },
      { key: 'disputes', label: 'Disputes', description: 'Chargebacks and case updates' },
      { key: 'customer_messages', label: 'Customer messages', description: 'Messages from buyers about orders' },
    ],
  },
  {
    title: 'Store',
    rows: [
      { key: 'inventory_alerts', label: 'Inventory alerts', description: 'Low and out of stock' },
      { key: 'payout_confirmations', label: 'Payouts', description: 'Payout sent or delayed' },
    ],
  },
];

/** Categories default ON server-side; treat a missing key as on. */
export function categoryValue(categories: Record<string, boolean> | null | undefined, key: string): boolean {
  return categories?.[key] !== false;
}
