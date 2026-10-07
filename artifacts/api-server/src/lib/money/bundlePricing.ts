/**
 * Bundle pricing — the ONE place that decides what a product bundle takes
 * off a seller group of the cart. Pure (no database, no Stripe), so every
 * checkout path (one-page PaymentIntent, hosted Checkout Session, guest
 * Checkout, POST /buyer/cart/validate) gets the same answer, and it is unit
 * tested on its own (__tests__/bundlePricing.test.ts).
 *
 * Rules:
 *  - Only bundles the buyer added (a cart line tagged with its bundleId)
 *    are considered. A tagged bundle that is gone, archived or still a
 *    draft is simply not applied (the lines are charged at full price).
 *  - A bundle that belongs to another seller than the group is an
 *    injection attempt: BundlePricingError BUNDLE_SELLER_MISMATCH.
 *  - A bundle applies once per complete set: every bundle item present at
 *    its quantity (a fixed variant, or any variant of the product when the
 *    seller left the size open). Quantities allowing, it applies several
 *    times. Each cart unit counts toward at most one bundle set; lines
 *    tagged with the bundle are used first.
 *  - Saving per set = full price of the units it used − bundle price,
 *    never negative and never more than those units cost.
 *  - The saving is spread over the lines it came from (exact to the cent),
 *    so tax is charged on what the buyer actually pays per line, and a
 *    discount code then applies to the remainder (bundle first, then code).
 */

export type BundleItemDef = { productId: string; variantId: string | null; quantity: number };

export type BundleDef = {
  id: string;
  ownerId: string;
  name: string;
  status: string;
  bundlePriceCents: number;
  items: BundleItemDef[];
};

export type BundleCartLine = {
  variantId: string;
  productId: string;
  quantity: number;
  /** Server price per unit. */
  priceCents: number;
  /** The bundle the buyer added this line with, if any. */
  bundleId?: string | null;
};

export type AppliedBundle = {
  bundleId: string;
  name: string;
  sets: number;
  itemsCents: number;
  bundlePriceCents: number;
  discountCents: number;
};

export type SkippedBundle = { bundleId: string; reason: "not_found" | "inactive" | "incomplete" | "no_saving" | "empty" };

export type BundlePricing = {
  bundleDiscountCents: number;
  applied: AppliedBundle[];
  skipped: SkippedBundle[];
  /** Per line (same order as the input): its share of the bundle savings, in cents. */
  lineDiscountCents: number[];
  /** Per line: the bundle it counted toward (null when none). */
  lineBundleId: Array<string | null>;
};

export class BundlePricingError extends Error {
  constructor(readonly code: "BUNDLE_SELLER_MISMATCH", message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "BundlePricingError";
  }
}

/** Upper bound on sets of one bundle in one order (quantities are already capped at 100 per line). */
const MAX_SETS = 100;

/** Proportional split of `amount` over `weights`, exact to the cent (the last weight takes the remainder). */
export function splitProportionally(weights: number[], amount: number): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const capped = Math.min(amount, total);
  let left = capped;
  let lastIndex = -1;
  weights.forEach((w, i) => { if (w > 0) lastIndex = i; });
  return weights.map((w, i) => {
    if (w <= 0) return 0;
    if (i === lastIndex) return left;
    const share = Math.floor((capped * w) / total);
    left -= share;
    return share;
  });
}

/**
 * Prices the bundles of ONE seller group.
 * `bundles` are the definitions of the bundleIds tagged on `lines` that the
 * database still has (missing ones are reported as skipped not_found).
 */
export function priceBundles(input: {
  sellerId: string;
  lines: BundleCartLine[];
  bundles: BundleDef[];
}): BundlePricing {
  const { lines } = input;
  const lineDiscountCents = lines.map(() => 0);
  const lineBundleId: Array<string | null> = lines.map(() => null);
  const applied: AppliedBundle[] = [];
  const skipped: SkippedBundle[] = [];

  // Requested bundles in the order the buyer's lines first mention them.
  const requested: string[] = [];
  for (const line of lines) {
    const id = typeof line.bundleId === "string" && line.bundleId ? line.bundleId : null;
    if (id && !requested.includes(id)) requested.push(id);
  }
  const byId = new Map(input.bundles.map((b) => [b.id, b]));

  // Injection guard first: never price anything if one tag points at another seller.
  for (const id of requested) {
    const bundle = byId.get(id);
    if (bundle && bundle.ownerId !== input.sellerId) {
      throw new BundlePricingError("BUNDLE_SELLER_MISMATCH", "That bundle isn't from this seller.", { bundleId: id });
    }
  }

  const remaining = lines.map((line) => Math.max(0, Math.floor(line.quantity)));

  for (const id of requested) {
    const bundle = byId.get(id);
    if (!bundle) { skipped.push({ bundleId: id, reason: "not_found" }); continue; }
    if (bundle.status !== "active") { skipped.push({ bundleId: id, reason: "inactive" }); continue; }
    const items = bundle.items.filter((item) => item.quantity > 0);
    if (items.length === 0) { skipped.push({ bundleId: id, reason: "empty" }); continue; }

    // Lines that can serve each bundle item, tagged lines first, then cart order.
    const candidates = items.map((item) => lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.productId === item.productId && (!item.variantId || line.variantId === item.variantId))
      .sort((a, b) => Number(b.line.bundleId === id) - Number(a.line.bundleId === id) || a.index - b.index)
      .map(({ index }) => index));

    const used = lines.map(() => 0);
    let sets = 0;
    let itemsCents = 0;
    let discountCents = 0;
    while (sets < MAX_SETS) {
      // Try to take one full set out of what is left.
      const take = lines.map(() => 0);
      let complete = true;
      for (let k = 0; k < items.length && complete; k++) {
        let need = items[k].quantity;
        for (const index of candidates[k]) {
          if (need <= 0) break;
          const free = remaining[index] - take[index];
          const n = Math.min(free, need);
          if (n > 0) { take[index] += n; need -= n; }
        }
        if (need > 0) complete = false;
      }
      if (!complete) break;
      const setCents = take.reduce((sum, n, i) => sum + n * lines[i].priceCents, 0);
      const setDiscount = Math.max(0, Math.min(setCents, setCents - Math.max(0, bundle.bundlePriceCents)));
      take.forEach((n, i) => { remaining[i] -= n; used[i] += n; });
      sets += 1;
      itemsCents += setCents;
      discountCents += setDiscount;
    }

    if (sets === 0) { skipped.push({ bundleId: id, reason: "incomplete" }); continue; }
    if (discountCents <= 0) {
      // Complete but saves nothing (the seller priced it at or above the
      // items): not applied, and its units stay free for other bundles.
      used.forEach((n, i) => { remaining[i] += n; });
      skipped.push({ bundleId: id, reason: "no_saving" });
      continue;
    }
    used.forEach((n, i) => { if (n > 0 && lineBundleId[i] === null) lineBundleId[i] = id; });
    applied.push({
      bundleId: id, name: bundle.name, sets, itemsCents,
      bundlePriceCents: Math.max(0, bundle.bundlePriceCents), discountCents,
    });
    const shares = splitProportionally(used.map((n, i) => n * lines[i].priceCents), discountCents);
    shares.forEach((share, i) => { lineDiscountCents[i] += share; });
  }

  return {
    bundleDiscountCents: applied.reduce((sum, b) => sum + b.discountCents, 0),
    applied,
    skipped,
    lineDiscountCents,
    lineBundleId,
  };
}

/**
 * The cart lines a discount code sees after the bundle saving came off:
 * the same units, at what they cost now, split into at most two price
 * points per line so the per-unit rules (free item, specific products)
 * still hold and the total is exact to the cent.
 */
export function linesAfterBundles(
  lines: Array<{ productId: string; priceCents: number; quantity: number }>,
  lineDiscountCents: number[],
): Array<{ productId: string; priceCents: number; quantity: number }> {
  const out: Array<{ productId: string; priceCents: number; quantity: number }> = [];
  lines.forEach((line, i) => {
    const discount = Math.max(0, lineDiscountCents[i] ?? 0);
    if (discount === 0 || line.quantity <= 0) { out.push({ ...line }); return; }
    const lineTotal = Math.max(0, line.priceCents * line.quantity - discount);
    const base = Math.floor(lineTotal / line.quantity);
    const extra = lineTotal - base * line.quantity; // units that cost one cent more
    if (line.quantity - extra > 0) out.push({ productId: line.productId, priceCents: base, quantity: line.quantity - extra });
    if (extra > 0) out.push({ productId: line.productId, priceCents: base + 1, quantity: extra });
  });
  return out;
}
