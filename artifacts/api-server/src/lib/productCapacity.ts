import { products } from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

/**
 * Same plan-limit rule as `hasProductCapacity` in routes/products.ts: live
 * (non-archived, non-deleted) products plus `requested` must fit under the
 * plan's limit. Takes the per-owner advisory lock so concurrent requests
 * cannot both slip under the cap.
 */
export async function hasProductCapacity(tx: any, ownerId: string, limit: number | null, requested: number): Promise<boolean> {
  if (limit === null) return true;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"product-limit:" + ownerId}))`);
  const [result] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(
      eq(products.ownerId, ownerId),
      ne(products.status, "archived"),
      isNull(products.deletedAt),
    ));
  return (result?.count ?? 0) + requested <= limit;
}
