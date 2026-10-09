/**
 * "Get ready to sell" — client view of GET /api/seller/launch-checklist/ready-to-sell
 * (Shopify home pattern: title, one-line subtitle, "0 / 6 completed", a
 * grouped list of steps with a dashed circle that becomes a check). The
 * server owns the done flags; this file owns the copy and where each row goes.
 */
export type ReadyToSellStepId =
  | 'first_product'
  | 'name_store'
  | 'shipping_rates'
  | 'payouts'
  | 'customize_store'
  | 'share_store';

export interface ReadyToSellResponse {
  steps: { id: ReadyToSellStepId; done: boolean }[];
  doneCount: number;
  total: number;
  complete: boolean;
  hasSale: boolean;
}

export const READY_TO_SELL_STEPS: Record<ReadyToSellStepId, { title: string; route: string }> = {
  first_product: { title: 'Add your first product', route: '/add-product' },
  name_store: { title: 'Name your store', route: '/store-setup-name' },
  shipping_rates: { title: 'Set your shipping rates', route: '/shipping' },
  payouts: { title: 'Set up payouts', route: '/payout-setup' },
  customize_store: { title: 'Customize your store', route: '/store-builder' },
  share_store: { title: 'Share your store', route: '/share-store' },
};

export const READY_TO_SELL_TITLE = 'Get ready to sell';
export const READY_TO_SELL_SUBTITLE = 'Use this guide to get your store up and running.';

export function completedLabel(r: Pick<ReadyToSellResponse, 'doneCount' | 'total'>): string {
  return `${r.doneCount} / ${r.total} completed`;
}

const ORDER: ReadyToSellStepId[] = [
  'first_product', 'name_store', 'shipping_rates', 'payouts', 'customize_store', 'share_store',
];

function build(doneIds: ReadyToSellStepId[], hasSale = false): ReadyToSellResponse {
  const steps = ORDER.map((id) => ({ id, done: doneIds.includes(id) }));
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length, hasSale };
}

/** Signed-out preview, fresh account: nothing done yet. */
export function buildFreshReadyToSell(): ReadyToSellResponse {
  return build([]);
}

/** Signed-out preview with `&demo=1`: a seller part-way through. */
export function buildDemoReadyToSell(): ReadyToSellResponse {
  return build(['first_product', 'name_store', 'payouts']);
}
