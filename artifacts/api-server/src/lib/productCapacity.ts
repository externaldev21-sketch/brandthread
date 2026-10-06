/**
 * How many more products a seller's plan allows (Starter caps the catalogue;
 * see planCatalogue.ts). Counts the same rows POST /api/products counts —
 * every non-archived, non-deleted product, drafts included — under the same
 * advisory lock, so imports and manual creation can't race past the cap.
 * Call inside a transaction; returns null when the plan has no limit.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { products } from "@workspace/db";

export async function remainingProductCapacity(tx: any, ownerId: string, limit: number | null): Promise<number | null> {
  if (limit === null) return null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"product-limit:" + ownerId}))`);
  const [result] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(
      eq(products.ownerId, ownerId),
      ne(products.status, "archived"),
      isNull(products.deletedAt),
    ));
  return Math.max(0, limit - (result?.count ?? 0));
}
