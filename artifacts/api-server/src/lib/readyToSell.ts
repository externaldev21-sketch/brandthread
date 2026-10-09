/**
 * "Get ready to sell" — the dashboard checklist a seller works through until
 * their first sale (Shopify home pattern). Each step is done from real
 * account state, never a stored tick. Pure so the route and tests share it.
 */

export const READY_TO_SELL_STEP_IDS = [
  "first_product",
  "name_store",
  "shipping_rates",
  "payouts",
  "customize_store",
  "share_store",
] as const;

export type ReadyToSellStepId = (typeof READY_TO_SELL_STEP_IDS)[number];

export interface ReadyToSellInput {
  productCount: number;
  brandName: string | null;
  hasShippingRates: boolean;
  stripeAccountStatus: string | null;
  logoUrl: string | null;
  storeAccentColor: string | null;
  storefrontSaved: boolean;
  storeShared: boolean;
  orderCount: number;
}

export interface ReadyToSell {
  steps: Array<{ id: ReadyToSellStepId; done: boolean }>;
  doneCount: number;
  total: number;
  complete: boolean;
  /** The checklist shows until the first sale; the sales hero after. */
  hasSale: boolean;
}

const filled = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

export function deriveReadyToSell(input: ReadyToSellInput): ReadyToSell {
  const done: Record<ReadyToSellStepId, boolean> = {
    first_product: input.productCount > 0,
    name_store: filled(input.brandName),
    shipping_rates: input.hasShippingRates,
    payouts: input.stripeAccountStatus === "active",
    customize_store: input.storefrontSaved || filled(input.logoUrl) || filled(input.storeAccentColor),
    share_store: input.storeShared,
  };
  const steps = READY_TO_SELL_STEP_IDS.map((id) => ({ id, done: done[id] }));
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, total: steps.length, complete: doneCount === steps.length, hasSale: input.orderCount > 0 };
}
