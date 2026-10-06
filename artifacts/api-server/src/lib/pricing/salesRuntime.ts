/**
 * DB-backed glue for automatic sales (see ./sales.ts for the rules).
 * Every function fails open: if the sales tables are unavailable the original
 * catalog price is used, so a sales outage can never block browsing or checkout.
 */
import { db, sales, productSales, products } from "@workspace/db";
import { and, eq, inArray, isNull, gt, lte, or } from "drizzle-orm";
import { resolveEffectivePrice, type SaleRule, type SaleTarget, type EffectivePrice } from "./sales";

const TTL_MS = 5_000;
const cache = new Map<string, { at: number; rules: SaleRule[] }>();

export function clearSalesCache(): void {
  cache.clear();
}

/** Live (in-window, active) sales for the given sellers. */
export async function loadLiveSales(sellerIds: readonly string[], now = new Date()): Promise<SaleRule[]> {
  const unique = [...new Set(sellerIds)];
  const out: SaleRule[] = [];
  const missing: string[] = [];
  for (const id of unique) {
    const hit = cache.get(id);
    if (hit && now.getTime() - hit.at < TTL_MS && hit.at <= now.getTime()) out.push(...hit.rules);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  try {
    const rows = await db.select().from(sales).where(and(
      inArray(sales.sellerId, missing),
      eq(sales.active, true),
      lte(sales.startsAt, now),
      or(isNull(sales.endsAt), gt(sales.endsAt, now)),
    ));
    const ids = rows.map((r) => r.id);
    const links = ids.length
      ? await db.select().from(productSales).where(inArray(productSales.saleId, ids))
      : [];
    const bySale = new Map<string, string[]>();
    for (const l of links) (bySale.get(l.saleId) ?? bySale.set(l.saleId, []).get(l.saleId)!).push(l.productId);
    const bySeller = new Map<string, SaleRule[]>(missing.map((m) => [m, []]));
    for (const r of rows) {
      const rule: SaleRule = {
        id: r.id, sellerId: r.sellerId, name: r.name,
        discountType: r.discountType === "fixed" ? "fixed" : "percent",
        value: r.value,
        scope: r.scope === "products" || r.scope === "collection" ? r.scope : "store",
        productIds: bySale.get(r.id) ?? [], collection: r.collection,
        startsAt: r.startsAt, endsAt: r.endsAt, active: r.active,
      };
      bySeller.get(r.sellerId)?.push(rule);
    }
    for (const [sellerId, rules] of bySeller) {
      cache.set(sellerId, { at: now.getTime(), rules });
      out.push(...rules);
    }
  } catch {
    /* fail open: no sales */
  }
  return out;
}

type VariantLike = { productId: string; priceCents: number; compareAtPriceCents?: number | null };

/**
 * Catalog responses: returns the variants with `priceCents` set to the sale
 * price and `compareAtPriceCents` to the strike-through price (plus
 * `saleId` / `saleName` / `salePercentOff`). Variants of products without an
 * active sale are returned untouched.
 */
export async function applySalesToVariants<V extends VariantLike>(
  prods: ReadonlyArray<{ id: string; ownerId: string; category?: string | null; tags?: unknown }>,
  variants: readonly V[],
  now = new Date(),
): Promise<V[]> {
  if (variants.length === 0) return [...variants];
  const rules = await loadLiveSales(prods.map((p) => p.ownerId), now);
  if (rules.length === 0) return [...variants];
  const byId = new Map(prods.map((p) => [p.id, p]));
  return variants.map((v) => {
    const p = byId.get(v.productId);
    if (!p) return v;
    const eff = resolveEffectivePrice({
      priceCents: v.priceCents, compareAtPriceCents: v.compareAtPriceCents,
      target: toTarget(p), sales: rules, now,
    });
    if (!eff.saleId) return v;
    return {
      ...v, priceCents: eff.priceCents, compareAtPriceCents: eff.compareAtPriceCents,
      saleId: eff.saleId, saleName: eff.saleName, salePercentOff: eff.percentOff,
    };
  });
}

function toTarget(p: { id: string; ownerId: string; category?: string | null; tags?: unknown }): SaleTarget {
  return {
    productId: p.id, sellerId: p.ownerId, category: p.category ?? null,
    tags: Array.isArray(p.tags) ? (p.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
  };
}

/**
 * Checkout hook: authoritative per-unit price for one variant. Used by every
 * path that charges a buyer so what is displayed is what is charged.
 */
export async function effectiveUnitPrice(input: {
  productId: string; sellerId: string; priceCents: number; compareAtPriceCents?: number | null; now?: Date;
}): Promise<EffectivePrice> {
  const now = input.now ?? new Date();
  const plain: EffectivePrice = {
    priceCents: input.priceCents, compareAtPriceCents: input.compareAtPriceCents ?? null,
    basePriceCents: input.priceCents, saleId: null, saleName: null, saleDiscountCents: 0, percentOff: 0,
  };
  const rules = await loadLiveSales([input.sellerId], now);
  if (rules.length === 0) return plain;
  try {
    const [p] = await db.select({ id: products.id, ownerId: products.ownerId, category: products.category, tags: products.tags })
      .from(products).where(eq(products.id, input.productId)).limit(1);
    if (!p) return plain;
    return resolveEffectivePrice({
      priceCents: input.priceCents, compareAtPriceCents: input.compareAtPriceCents,
      target: toTarget(p), sales: rules, now,
    });
  } catch {
    return plain;
  }
}
