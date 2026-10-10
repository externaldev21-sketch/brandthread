import { products } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * The plan's product cap counts ACTIVE (published, live) products only.
 * Drafts, archived, sold-out-hidden and deleted products don't count, and a
 * product's variants (sizes/colours) are one product. Publishing is what is
 * limited; drafts can always be saved (Dev's plan-tier spec).
 */
export function activeProductsWhere(ownerId: string) {
  return and(eq(products.ownerId, ownerId), eq(products.status, "active"), isNull(products.deletedAt));
}

export async function countActiveProducts(executor: any, ownerId: string): Promise<number> {
  const [result] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(activeProductsWhere(ownerId));
  return result?.count ?? 0;
}

/**
 * True when `requested` more products can go live under `limit` (null =
 * unlimited). Takes the per-owner advisory lock first, so concurrent
 * publishes can't both slip under the cap. `requested` 0 always fits.
 */
export async function hasProductCapacity(tx: any, ownerId: string, limit: number | null, requested: number): Promise<boolean> {
  if (limit === null || requested <= 0) return true;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"product-limit:" + ownerId}))`);
  return (await countActiveProducts(tx, ownerId)) + requested <= limit;
}
