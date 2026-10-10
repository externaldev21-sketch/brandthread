/**
 * The pure money rules of the in-app cart payment (no database, no Stripe),
 * re-exported by lib/money/cartCheckout.ts and unit tested on their own
 * (cartMath.test.ts).
 *
 *  - spreadDiscount / taxableAmounts: what Stripe Tax sees per group;
 *  - allocateThreadCash: one Thread Cash amount split across stores;
 *  - planCartRewards: where a cart's loyalty and Thread Cash go.
 */

/** Stripe's minimum USD card charge. */
export const MIN_CARD_CHARGE_CENTS = 50;

export class CartCheckoutError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CartCheckoutError";
  }
}

/** The parts of a priced seller group these rules read (lib/money/cartCheckout.ts PricedGroup). */
export type GroupAmounts = {
  items: Array<{ priceCents: number; quantity: number }>;
  subtotalCents: number;
  shippingCents: number;
  /** Promo on merchandise + any free-shipping part. */
  discountCents: number;
  merchandiseDiscountCents: number;
  shippingDiscountCents: number;
};

/** Spreads a discount across line amounts in proportion, exact to the cent (the last line takes the remainder). */
export function spreadDiscount(lineAmounts: number[], discountCents: number): number[] {
  const total = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  if (discountCents <= 0 || total <= 0) return [...lineAmounts];
  const capped = Math.min(discountCents, total);
  let left = capped;
  return lineAmounts.map((amount, index) => {
    if (index === lineAmounts.length - 1) return amount - left;
    const share = Math.floor((capped * amount) / total);
    left -= share;
    return amount - share;
  });
}

/**
 * The amounts Stripe Tax sees for one group: merchandise lines after the
 * promo, then any reward discount (loyalty, Thread Cash) on the merchandise
 * first and the shipping after, the way hosted Checkout's single coupon
 * discounts the taxable amount.
 */
export function taxableAmounts(
  group: Pick<GroupAmounts, "items" | "merchandiseDiscountCents" | "shippingCents" | "shippingDiscountCents">,
  rewardDiscountCents = 0,
): { lineAmounts: number[]; shippingCents: number } {
  const afterPromo = spreadDiscount(group.items.map((i) => i.priceCents * i.quantity), group.merchandiseDiscountCents)
    .map((amount) => Math.max(0, amount));
  const merchandise = afterPromo.reduce((sum, amount) => sum + amount, 0);
  const reward = Math.max(0, rewardDiscountCents);
  const onMerchandise = Math.min(reward, merchandise);
  const shipping = Math.max(0, group.shippingCents - group.shippingDiscountCents);
  return {
    lineAmounts: spreadDiscount(afterPromo, onMerchandise).map((amount) => Math.max(0, amount)),
    shippingCents: Math.max(0, shipping - (reward - onMerchandise)),
  };
}

// ─── Rewards on a cart (loyalty, Thread Cash) ────────────────────────────────

/**
 * What one group still costs before tax once its promo and any loyalty
 * discount are off. Thread Cash is taken from this.
 */
export function groupPreTaxRemainingCents(group: Pick<GroupAmounts, "subtotalCents" | "shippingCents" | "discountCents">, loyaltyCents = 0): number {
  return Math.max(0, group.subtotalCents + group.shippingCents - group.discountCents - Math.max(0, loyaltyCents));
}

/**
 * The most Thread Cash one group can take: its pre-tax remainder less
 * Stripe's minimum card charge, so every store's share of the payment stays
 * a real card charge (the same rule the hosted flow applies to its one
 * session, STRIPE_MIN_CARD_CHARGE_CENTS in routes/buyer.ts).
 */
export function threadCashGroupCeilingCents(preTaxRemainingCents: number, minChargeCents = MIN_CARD_CHARGE_CENTS): number {
  return Math.max(0, preTaxRemainingCents - minChargeCents);
}

/**
 * Splits one Thread Cash amount across seller groups, in proportion to what
 * each group can take (its ceiling), exact to the cent and never above any
 * group's ceiling. Leftover cents go to the groups with the largest
 * fractional share (ties: earlier group first). Returns null when the amount
 * is more than all groups together can take.
 *
 * Thread Cash is Brandthread-funded, so the split doesn't change any
 * seller's payout (each is topped up for its share,
 * lib/threadCash/checkoutTopup.ts); splitting in proportion keeps every
 * store's card share above Stripe's minimum and each order's refund maths
 * local to that order.
 */
export function allocateThreadCash(amountCents: number, ceilings: number[]): number[] | null {
  if (!Number.isInteger(amountCents) || amountCents < 0) return null;
  const caps = ceilings.map((cap) => (Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0));
  const room = caps.reduce((sum, cap) => sum + cap, 0);
  if (amountCents > room) return null;
  if (amountCents === 0 || room === 0) return caps.map(() => 0);
  const shares = caps.map((cap) => Math.floor((amountCents * cap) / room));
  let left = amountCents - shares.reduce((sum, share) => sum + share, 0);
  const order = caps
    .map((cap, index) => ({ index, fraction: (amountCents * cap) % room }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  while (left > 0) {
    let moved = false;
    for (const { index } of order) {
      if (left === 0) break;
      if (shares[index] < caps[index]) {
        shares[index] += 1;
        left -= 1;
        moved = true;
      }
    }
    if (!moved) return null;
  }
  return shares;
}

export type CartRewardPlan = {
  /** Loyalty discount per group (one group at most). */
  loyaltyCents: number[];
  /** Thread Cash per group (allocateThreadCash). */
  threadCashCents: number[];
};

/**
 * Where a cart's loyalty and Thread Cash go, given its priced groups.
 * Loyalty: one store only, like hosted Checkout (its token discounts one
 * checkout). Thread Cash: every store, allocateThreadCash. Throws
 * CartCheckoutError with the hosted flow's codes when the rewards can't fit.
 */
export function planCartRewards(
  groups: Array<Pick<GroupAmounts, "subtotalCents" | "shippingCents" | "discountCents">>,
  rewards: { loyaltyCents?: number; threadCashCents?: number },
  minChargeCents = MIN_CARD_CHARGE_CENTS,
): CartRewardPlan {
  const loyalty = Math.max(0, rewards.loyaltyCents ?? 0);
  const threadCash = Math.max(0, rewards.threadCashCents ?? 0);
  const loyaltyCents = groups.map(() => 0);
  if (loyalty > 0) {
    if (groups.length !== 1) {
      throw new CartCheckoutError(400, "LOYALTY_ONE_STORE", "Rewards points work on one store's order at a time. Check out this store on its own.");
    }
    if (loyalty > groupPreTaxRemainingCents(groups[0]) - minChargeCents) {
      throw new CartCheckoutError(400, "LOYALTY_DISCOUNT_TOO_LARGE", "Choose fewer points so your order still has a balance to pay.");
    }
    loyaltyCents[0] = loyalty;
  }
  const ceilings = groups.map((group, index) => threadCashGroupCeilingCents(groupPreTaxRemainingCents(group, loyaltyCents[index]), minChargeCents));
  const threadCashCents = allocateThreadCash(threadCash, ceilings);
  if (!threadCashCents) {
    throw new CartCheckoutError(400, "THREAD_CASH_DISCOUNT_TOO_LARGE", "Choose less Thread Cash so your order still has a balance to pay.");
  }
  return { loyaltyCents, threadCashCents };
}
