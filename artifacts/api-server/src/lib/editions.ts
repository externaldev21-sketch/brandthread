/**
 * Numbered pieces: a product can be a limited numbered run ("No. 014 of 200").
 *
 * Numbers are handed out when an order is paid (webhook, same transaction as
 * the order items), in payment order, from a per-product counter that is only
 * ever incremented — so a number is never reused or reassigned, and a refund
 * leaves a gap instead of renumbering other buyers' pieces. A unit that would
 * go past the run size gets no number.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { orderItems, productVariants, products } from "@workspace/db";

export const EDITION_SIZE_MIN = 2;
export const EDITION_SIZE_MAX = 100_000;

export type EditionSizeProblem = { status: number; error: string; code: string };

/**
 * Validates a requested run size. `undefined` = untouched. `issued` is how many
 * numbers already went out (0 for a new product).
 */
export function validateEditionSize(value: unknown, issued: number): EditionSizeProblem | null {
  if (value === undefined) return null;
  if (value === null) {
    return issued > 0
      ? { status: 409, error: "Pieces in this run are already numbered, so it stays a numbered run.", code: "EDITION_IN_USE" }
      : null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < EDITION_SIZE_MIN || value > EDITION_SIZE_MAX) {
    return { status: 400, error: `A numbered run is ${EDITION_SIZE_MIN} to ${EDITION_SIZE_MAX.toLocaleString("en-US")} pieces.`, code: "EDITION_SIZE_INVALID" };
  }
  if (value < issued) {
    return { status: 409, error: `${issued} pieces are already numbered, so the run can't be smaller than ${issued}.`, code: "EDITION_SIZE_BELOW_ISSUED" };
  }
  return null;
}

type Executor = { select: any; update: any };

/**
 * Gives each line item of a numbered product its numbers. Call inside the
 * order transaction, after the items are inserted.
 */
export async function assignEditionNumbers(
  tx: Executor,
  items: Array<{ id: string; variantId: string | null; quantity: number }>,
): Promise<void> {
  const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is string => !!v))];
  if (variantIds.length === 0) return;
  const rows: Array<{ variantId: string; productId: string; editionSize: number | null }> = await tx
    .select({ variantId: productVariants.id, productId: productVariants.productId, editionSize: products.editionSize })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));
  const numbered = new Map(rows.filter((r) => r.editionSize !== null).map((r) => [r.variantId, r.productId]));
  if (numbered.size === 0) return;
  // Payment order within one order = line order.
  for (const item of items) {
    const productId = item.variantId ? numbered.get(item.variantId) : undefined;
    if (!productId || item.quantity < 1) continue;
    // Atomic claim of the next `quantity` numbers; no row back = the run is full.
    const [claimed]: Array<{ issued: number }> = await tx.update(products)
      .set({ editionIssued: sql`${products.editionIssued} + ${item.quantity}` })
      .where(and(
        eq(products.id, productId),
        sql`${products.editionSize} IS NOT NULL`,
        sql`${products.editionIssued} + ${item.quantity} <= ${products.editionSize}`,
      ))
      .returning({ issued: products.editionIssued });
    if (!claimed) continue;
    await tx.update(orderItems)
      .set({ editionNumber: claimed.issued - item.quantity + 1 })
      .where(eq(orderItems.id, item.id));
  }
}
