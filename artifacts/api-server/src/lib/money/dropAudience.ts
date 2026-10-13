/**
 * Who may buy a members-only drop: buyers who already have a paid order from
 * the seller that wasn't cancelled or fully refunded. Server-side only — the
 * app shows the lock, checkoutPlan.ts enforces it.
 */
import { and, eq, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db, orders } from "@workspace/db";
import type { DbExecutor } from "./ledger";

export async function isPastBuyer(
  buyerId: string | null | undefined,
  sellerId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  if (!buyerId || !sellerId || buyerId === sellerId) return false;
  const [row] = await executor.select({ id: orders.id }).from(orders)
    .where(and(
      eq(orders.ownerId, sellerId),
      eq(orders.buyerId, buyerId),
      isNotNull(orders.paidAt),
      ne(orders.status, "cancelled"),
      lt(orders.refundedCents, sql`${orders.totalCents}`),
    ))
    .limit(1);
  return !!row;
}
