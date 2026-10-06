/**
 * Empty states for the seller Products and Orders lists. Each one says
 * exactly what the selected filter (or search) found — nothing — in a single
 * title, with no filler sentence underneath. Only "All" and "Active"
 * products offer an "Add product" action: adding a product can't produce an
 * archived product, a draft-only list item, an order, etc.
 */
import type { Feather } from '@expo/vector-icons';

type FeatherName = keyof typeof Feather.glyphMap;

export interface ListEmptyCopy {
  icon: FeatherName;
  title: string;
  /** Present only when the empty list has a real next step. */
  action?: 'add-product';
}

const PRODUCT_EMPTY: Record<string, ListEmptyCopy> = {
  all: { icon: 'package', title: 'No products yet', action: 'add-product' },
  active: { icon: 'check-circle', title: 'No active products', action: 'add-product' },
  draft: { icon: 'edit-2', title: 'No drafts' },
  scheduled: { icon: 'clock', title: 'Nothing scheduled' },
  archived: { icon: 'archive', title: 'No archived products' },
  'pre-order': { icon: 'calendar', title: 'No pre-order products' },
  'pre-made': { icon: 'box', title: 'No pre-made products' },
  'low-stock': { icon: 'alert-triangle', title: 'Nothing low on stock' },
  'out-of-stock': { icon: 'x-circle', title: 'Nothing out of stock' },
};

const ORDER_EMPTY: Record<string, ListEmptyCopy> = {
  all: { icon: 'shopping-bag', title: 'No orders yet' },
  new: { icon: 'inbox', title: 'No new orders' },
  unfulfilled: { icon: 'package', title: 'No unfulfilled orders' },
  unpaid: { icon: 'credit-card', title: 'No unpaid orders' },
  open: { icon: 'clock', title: 'No open orders' },
  archived: { icon: 'archive', title: 'No archived orders' },
  processing: { icon: 'loader', title: 'No orders in processing' },
  ready_to_ship: { icon: 'box', title: 'No orders ready to ship' },
  shipped: { icon: 'truck', title: 'No shipped orders' },
  delivered: { icon: 'check-circle', title: 'No delivered orders' },
  cancelled: { icon: 'x-circle', title: 'No cancelled orders' },
  returned: { icon: 'rotate-ccw', title: 'No returns' },
  pre_order: { icon: 'calendar', title: 'No pre-orders' },
  manufacturer_fulfilled: { icon: 'tool', title: 'No manufacturer orders' },
  high_risk: { icon: 'alert-triangle', title: 'No high-risk orders' },
  disputed: { icon: 'alert-octagon', title: 'No disputed orders' },
  partially_fulfilled: { icon: 'package', title: 'No partly fulfilled orders' },
  refunded: { icon: 'rotate-ccw', title: 'No refunded orders' },
  seller_fulfilled: { icon: 'package', title: 'No self-fulfilled orders' },
};

export function productEmptyCopy(filter: string, searchQuery?: string): ListEmptyCopy {
  if (searchQuery?.trim()) return { icon: 'search', title: 'No matching products' };
  return PRODUCT_EMPTY[filter] ?? PRODUCT_EMPTY.all;
}

export function orderEmptyCopy(filter: string, searchQuery?: string): ListEmptyCopy {
  if (searchQuery?.trim()) return { icon: 'search', title: 'No matching orders' };
  return ORDER_EMPTY[filter] ?? ORDER_EMPTY.all;
}

/** Exposed for tests: every filter key each screen can select. */
export const PRODUCT_EMPTY_FILTERS = Object.keys(PRODUCT_EMPTY);
export const ORDER_EMPTY_FILTERS = Object.keys(ORDER_EMPTY);
