/**
 * Seller bundle discounts ("Buy the set"), pure so the rule is unit-testable.
 *
 * A bundle (product_bundles + bundle_items) sells a fixed set of items for
 * bundlePriceCents. For ONE seller group of a cart this finds every complete
 * copy of a bundle in the lines and takes the difference off merchandise:
 *  - a bundle item matches a line by productId, and by variantId when the
 *    seller pinned one; it needs >= quantity units;
 *  - units are never used by two bundle copies;
 *  - greedy: the copy with the biggest saving is applied first, again and
 *    again, until no complete copy saves anything;
 *  - saving per copy = matched units' prices − bundlePriceCents, never
 *    negative and never more than the matched merchandise.
 * Callers apply this BEFORE a discount code, which then works on what is left
 * (see lib/money/cartCheckout.ts).
 */

export interface BundleCartLine {
  productId: string;
  variantId: string;
  /** Server-decided unit price (after automatic sales). */
  unitPriceCents: number;
  quantity: number;
}

export interface ActiveBundle {
  id: string;
  name: string;
  bundlePriceCents: number;
  items: Array<{ productId: string; variantId: string | null; quantity: number }>;
}

export interface AppliedBundle {
  bundleId: string;
  name: string;
  copies: number;
  discountCents: number;
}

export interface BundleDiscountResult {
  /** Sum over applied bundles. */
  totalDiscountCents: number;
  applied: AppliedBundle[];
  /** Cents of the bundle discount carried by each input line, same order as the input. */
  lineDiscountCents: number[];
}

type Take = { line: number; units: number; unitPriceCents: number };

/** Units one copy of `bundle` would use from `remaining`, or null when it isn't complete. */
function takeOneCopy(bundle: ActiveBundle, lines: BundleCartLine[], remaining: number[]): Take[] | null {
  const left = [...remaining];
  const takes: Take[] = [];
  // Pinned items first, so an unpinned item can't eat the exact variant a
  // pinned one needs.
  const items = [...bundle.items].sort((a, b) => Number(!!b.variantId) - Number(!!a.variantId));
  for (const item of items) {
    let need = Math.max(1, Math.floor(item.quantity));
    // Most expensive matching units first: the buyer gets the larger saving.
    const candidates = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => left[index] > 0
        && line.productId === item.productId
        && (!item.variantId || line.variantId === item.variantId))
      .sort((a, b) => b.line.unitPriceCents - a.line.unitPriceCents);
    for (const { line, index } of candidates) {
      if (need === 0) break;
      const units = Math.min(need, left[index]);
      left[index] -= units;
      need -= units;
      takes.push({ line: index, units, unitPriceCents: line.unitPriceCents });
    }
    if (need > 0) return null;
  }
  return takes;
}

function savingOf(bundle: ActiveBundle, takes: Take[]): { matched: number; saving: number } {
  const matched = takes.reduce((sum, t) => sum + t.units * Math.max(0, t.unitPriceCents), 0);
  const saving = Math.min(matched, Math.max(0, matched - bundle.bundlePriceCents));
  return { matched, saving };
}

export function applyBundleDiscounts(lines: BundleCartLine[], activeBundles: ActiveBundle[]): BundleDiscountResult {
  const remaining = lines.map((line) => Math.max(0, Math.floor(line.quantity)));
  const lineDiscountCents = lines.map(() => 0);
  const appliedById = new Map<string, AppliedBundle>();
  const usable = activeBundles.filter((bundle) => bundle.items.length > 0 && bundle.bundlePriceCents > 0);

  for (;;) {
    let best: { bundle: ActiveBundle; takes: Take[]; matched: number; saving: number } | null = null;
    for (const bundle of usable) {
      const takes = takeOneCopy(bundle, lines, remaining);
      if (!takes) continue;
      const { matched, saving } = savingOf(bundle, takes);
      if (saving > 0 && (!best || saving > best.saving)) best = { bundle, takes, matched, saving };
    }
    if (!best) break;

    // Spread this copy's saving over the units it used, exact to the cent.
    let left = best.saving;
    best.takes.forEach((take, i) => {
      remaining[take.line] -= take.units;
      const share = i === best!.takes.length - 1
        ? left
        : Math.floor((best!.saving * take.units * take.unitPriceCents) / best!.matched);
      left -= share;
      lineDiscountCents[take.line] += share;
    });

    const prior = appliedById.get(best.bundle.id);
    appliedById.set(best.bundle.id, {
      bundleId: best.bundle.id,
      name: best.bundle.name,
      copies: (prior?.copies ?? 0) + 1,
      discountCents: (prior?.discountCents ?? 0) + best.saving,
    });
  }

  const applied = [...appliedById.values()];
  return {
    totalDiscountCents: applied.reduce((sum, a) => sum + a.discountCents, 0),
    applied,
    lineDiscountCents,
  };
}
