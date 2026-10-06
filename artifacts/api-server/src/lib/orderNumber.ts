import { sql } from "drizzle-orm";

type SqlExecutor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Next per-seller order number ("BT-00042"). Must run inside the transaction
 * that inserts the order.
 *
 * A transaction-scoped advisory lock per seller serialises numbering, so two
 * orders paid at the same moment (two webhooks, or a webhook and a manual
 * order) can't both read the same value and share a number. Numbering
 * continues from the highest existing BT number rather than a row count, so
 * a removed order never causes a later one to reuse a number.
 */
export async function nextOrderNumber(tx: SqlExecutor, ownerId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`order_number:${ownerId}`}))`);
  const result = await tx.execute(sql`
    SELECT coalesce(max(substring(order_number FROM 4)::int), 0)::int AS n
    FROM orders
    WHERE owner_id = ${ownerId} AND order_number ~ '^BT-[0-9]{1,9}$'
  `);
  const current = Number((result as any).rows?.[0]?.n ?? 0);
  return `BT-${String(current + 1).padStart(5, "0")}`;
}
