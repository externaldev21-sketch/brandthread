/**
 * A published product whose every variant has 0 in stock (stock tracked,
 * overselling off, not a pre-order) shows as Sold out to buyers. The seller
 * is asked before publishing it that way.
 */
export function publishesSoldOut(input: {
  status: 'active' | 'draft';
  trackInventory: boolean;
  allowOversell: boolean;
  isPreOrder: boolean;
  totalStock: number;
}): boolean {
  return input.status === 'active'
    && input.trackInventory
    && !input.allowOversell
    && !input.isPreOrder
    && input.totalStock <= 0;
}

export const SOLD_OUT_CONFIRM = {
  title: 'Every option is out of stock',
  message: 'Buyers will see this product as sold out. Publish anyway?',
  confirm: 'Publish anyway',
  cancel: 'Add stock',
} as const;
