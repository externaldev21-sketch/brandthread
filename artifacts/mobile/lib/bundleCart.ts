/**
 * Bundles in the cart — pure helpers (no React, no storage), unit-tested in
 * bundleCart.test.ts.
 *
 * Adding a bundle adds each of its items as a normal cart line tagged with
 * the bundle id, and keeps a small snapshot of the bundle on the line so the
 * cart can show "Bundle savings" offline. The server is the source of truth
 * at checkout (api-server lib/money/bundlePricing.ts); `bundleSavings` here
 * mirrors its rules so the cart's estimate matches what checkout charges:
 * only bundles the buyer added, complete sets only (several when quantities
 * allow), each unit counts once, saving = items − bundle price, never
 * negative.
 */
import type { PublicBundle, PublicBundleItem, PublicBundleVariant } from '@/lib/api';

export type CartBundleSnapshot = {
  id: string;
  name: string;
  sellerId: string;
  bundlePriceCents: number;
  items: Array<{ productId: string; variantId: string | null; quantity: number }>;
};

export type BundleLineLike = {
  productId: string;
  variantId: string;
  quantity: number;
  priceCents: number;
  bundleId?: string;
  bundle?: CartBundleSnapshot;
};

export type AppliedCartBundle = { bundleId: string; name: string; sets: number; discountCents: number };

export function snapshotOf(bundle: PublicBundle): CartBundleSnapshot {
  return {
    id: bundle.id,
    name: bundle.name,
    sellerId: bundle.sellerId,
    bundlePriceCents: bundle.bundlePriceCents,
    items: bundle.items.map(item => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity })),
  };
}

/** Bundle savings for these cart lines (estimate; checkout recomputes server-side). */
export function bundleSavings(lines: BundleLineLike[]): { totalCents: number; bundles: AppliedCartBundle[] } {
  const requested: CartBundleSnapshot[] = [];
  for (const line of lines) {
    if (line.bundleId && line.bundle && line.bundle.id === line.bundleId && !requested.some(b => b.id === line.bundleId)) {
      requested.push(line.bundle);
    }
  }
  const remaining = lines.map(line => Math.max(0, Math.floor(line.quantity)));
  const bundles: AppliedCartBundle[] = [];
  for (const bundle of requested) {
    const items = bundle.items.filter(item => item.quantity > 0);
    if (items.length === 0) continue;
    const candidates = items.map(item => lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.productId === item.productId && (!item.variantId || line.variantId === item.variantId))
      .sort((a, b) => Number(b.line.bundleId === bundle.id) - Number(a.line.bundleId === bundle.id) || a.index - b.index)
      .map(({ index }) => index));
    const used = lines.map(() => 0);
    let sets = 0;
    let discountCents = 0;
    while (sets < 100) {
      const take = lines.map(() => 0);
      let complete = true;
      for (let k = 0; k < items.length && complete; k++) {
        let need = items[k].quantity;
        for (const index of candidates[k]) {
          if (need <= 0) break;
          const n = Math.min(remaining[index] - take[index], need);
          if (n > 0) { take[index] += n; need -= n; }
        }
        if (need > 0) complete = false;
      }
      if (!complete) break;
      const setCents = take.reduce((sum, n, i) => sum + n * lines[i].priceCents, 0);
      discountCents += Math.max(0, Math.min(setCents, setCents - Math.max(0, bundle.bundlePriceCents)));
      take.forEach((n, i) => { remaining[i] -= n; used[i] += n; });
      sets += 1;
    }
    if (sets === 0) continue;
    if (discountCents <= 0) {
      used.forEach((n, i) => { remaining[i] += n; });
      continue;
    }
    bundles.push({ bundleId: bundle.id, name: bundle.name, sets, discountCents });
  }
  return { totalCents: bundles.reduce((sum, b) => sum + b.discountCents, 0), bundles };
}

/** The variant each bundle item will be added as: the fixed one, the buyer's pick, or the only one in stock. */
export function resolveBundleVariant(item: PublicBundleItem, selections: Record<string, string | undefined>): PublicBundleVariant | null {
  if (item.variantId) return item.variants.find(v => v.id === item.variantId) ?? null;
  const picked = selections[item.id];
  if (picked) return item.variants.find(v => v.id === picked) ?? null;
  return item.variants.length === 1 ? item.variants[0] : null;
}

/** Items still waiting for a size/color choice. */
export function missingBundleSelections(bundle: PublicBundle, selections: Record<string, string | undefined>): PublicBundleItem[] {
  return bundle.items.filter(item => !resolveBundleVariant(item, selections));
}

/** What the bundle costs with these choices, and what it saves (variants can differ in price). */
export function bundleSelectionTotals(bundle: PublicBundle, selections: Record<string, string | undefined>) {
  const itemsCents = bundle.items.reduce((sum, item) => {
    const variant = resolveBundleVariant(item, selections);
    return sum + (variant?.priceCents ?? item.priceCents) * item.quantity;
  }, 0);
  const savingsCents = Math.max(0, itemsCents - Math.max(0, bundle.bundlePriceCents));
  return { itemsCents, savingsCents, priceCents: itemsCents - savingsCents };
}

export function variantLabel(variant: Pick<PublicBundleVariant, 'size' | 'color'>): string {
  return [variant.size, variant.color].filter(Boolean).join(' / ') || 'One size';
}
