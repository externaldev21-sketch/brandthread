/**
 * DB-backed glue for the wholesale price list (rules: ./wholesale.ts).
 * Fails open to retail: if the wholesale tables can't be read, the buyer pays
 * the normal (sale) price, so a wholesale outage never blocks checkout.
 */
import { db, productVariants, wholesaleBuyers, wholesalePrices, wholesaleSettings } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { resolveWholesalePrice, type WholesaleResult, type WholesaleRule, type WholesaleSettings } from "./wholesale";

export async function loadWholesaleSettings(sellerId: string): Promise<WholesaleSettings | null> {
  const [row] = await db.select().from(wholesaleSettings).where(eq(wholesaleSettings.sellerId, sellerId)).limit(1);
  return row ? { enabled: row.enabled, minOrderCents: row.minOrderCents, defaultPercentOff: row.defaultPercentOff } : null;
}

export async function isApprovedWholesaleBuyer(sellerId: string, buyerId: string): Promise<boolean> {
  const [row] = await db.select({ status: wholesaleBuyers.status }).from(wholesaleBuyers)
    .where(and(eq(wholesaleBuyers.sellerId, sellerId), eq(wholesaleBuyers.buyerId, buyerId))).limit(1);
  return row?.status === "approved";
}

export async function loadWholesaleRules(sellerId: string, productIds: readonly string[]): Promise<WholesaleRule[]> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return [];
  const rows = await db.select().from(wholesalePrices)
    .where(and(eq(wholesalePrices.sellerId, sellerId), inArray(wholesalePrices.productId, ids)));
  return rows.map((r) => ({ productId: r.productId, variantId: r.variantId, priceCents: r.priceCents, minQuantity: r.minQuantity }));
}

/**
 * Checkout hook. `lines[i].priceCents` is what the line costs today (after
 * any automatic sale). Returns, per line, the wholesale unit price to charge
 * instead, or null to keep the current price. All nulls unless the buyer is
 * an approved wholesale buyer of this seller and the order qualifies.
 *
 * Callers set the line's price to the returned value AND drop that line from
 * the discount-code lines: wholesale never stacks with sales or codes.
 */
export async function wholesaleUnitPrices(input: {
  sellerId: string;
  buyerId: string | null | undefined;
  lines: ReadonlyArray<{ productId: string; variantId: string; quantity: number; priceCents: number }>;
}): Promise<Array<number | null>> {
  const none = input.lines.map(() => null);
  if (!input.buyerId || input.lines.length === 0) return none;
  try {
    const result = await resolveWholesaleForBuyer({ ...input, buyerId: input.buyerId });
    if (!result?.applied) return none;
    return result.lines.map((l) => (l.wholesale ? l.unitCents : null));
  } catch {
    return none; // fail open: retail
  }
}

/**
 * The few-line checkout hook every server pricing path calls once per seller
 * group, after its per-line (sale) pricing: sets `lines[i].priceCents` to the
 * wholesale price where one applies and removes those lines from
 * `discountLines` (parallel to `lines`) so a discount code can't stack on top.
 * Returns the per-line wholesale prices (null = unchanged).
 */
export async function applyWholesaleToCart(input: {
  sellerId: string;
  buyerId: string | null | undefined;
  lines: Array<{ productId: string; variantId: string; quantity: number; priceCents: number }>;
  discountLines?: unknown[];
}): Promise<Array<number | null>> {
  const prices = await wholesaleUnitPrices(input);
  prices.forEach((cents, i) => { if (cents != null) input.lines[i].priceCents = cents; });
  if (input.discountLines) {
    for (let i = prices.length - 1; i >= 0; i--) if (prices[i] != null) input.discountLines.splice(i, 1);
  }
  return prices;
}

/** Full resolution (used by the checkout hook and the buyer's price list). Null when the seller has no price list on. */
export async function resolveWholesaleForBuyer(input: {
  sellerId: string;
  buyerId: string;
  lines: ReadonlyArray<{ productId: string; variantId: string; quantity: number; priceCents: number }>;
}): Promise<WholesaleResult | null> {
  const settings = await loadWholesaleSettings(input.sellerId);
  if (!settings?.enabled) return null;
  const approved = await isApprovedWholesaleBuyer(input.sellerId, input.buyerId);
  if (!approved) return resolveWholesalePrice({ settings, approved, rules: [], lines: [] });
  const rules = await loadWholesaleRules(input.sellerId, input.lines.map((l) => l.productId));
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  const retailRows = variantIds.length
    ? await db.select({ id: productVariants.id, priceCents: productVariants.priceCents }).from(productVariants)
      .where(inArray(productVariants.id, variantIds))
    : [];
  const retailById = new Map(retailRows.map((r) => [r.id, r.priceCents]));
  return resolveWholesalePrice({
    settings, approved, rules,
    lines: input.lines.map((l) => ({
      productId: l.productId, variantId: l.variantId, quantity: l.quantity,
      retailUnitCents: retailById.get(l.variantId) ?? l.priceCents,
      currentUnitCents: l.priceCents,
    })),
  });
}
