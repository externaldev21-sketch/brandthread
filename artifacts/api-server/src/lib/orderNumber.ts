/**
 * Short, human order numbers: `BT-4821`.
 *
 * Order numbers used to be a per-seller count (`BT-00001`), so every store
 * had its own BT-00001 and two sellers' orders could share a number. A
 * buyer reading their number to support, or a seller searching for it,
 * needs it to point at exactly one order, so numbers are now random and
 * checked against every order.
 *
 * Four digits first (#BT-4821). When a few draws in a row are taken, the
 * number grows a digit, so the space never runs out. New numbers never
 * start with 0, so they can't be confused with an old zero-padded one.
 * The row id stays the real key; this is the label people read.
 */
import { sql } from "drizzle-orm";

export const ORDER_NUMBER_PREFIX = "BT-";
const TRIES_PER_LENGTH = 4;
const MIN_DIGITS = 4;
const MAX_DIGITS = 9;

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/** A random `BT-` number with `digits` digits and no leading zero. */
export function randomOrderNumber(digits: number, random: () => number = Math.random): string {
  const min = 10 ** (digits - 1);
  const value = min + Math.floor(random() * (9 * min));
  return `${ORDER_NUMBER_PREFIX}${Math.min(value, 10 ** digits - 1)}`;
}

/**
 * Picks an order number no other order has. `isTaken` is injectable for
 * tests; the default asks the orders table (indexed by migration 285).
 */
export async function generateOrderNumber(
  isTaken: (candidate: string) => Promise<boolean>,
  random: () => number = Math.random,
): Promise<string> {
  for (let digits = MIN_DIGITS; digits <= MAX_DIGITS; digits += 1) {
    for (let attempt = 0; attempt < TRIES_PER_LENGTH; attempt += 1) {
      const candidate = randomOrderNumber(digits, random);
      if (!(await isTaken(candidate))) return candidate;
    }
  }
  throw new Error("Could not find a free order number");
}

/** `generateOrderNumber` against the orders table, inside the caller's transaction. */
export function generateOrderNumberIn(tx: Executor): Promise<string> {
  return generateOrderNumber(async (candidate) => {
    const result = await tx.execute(sql`SELECT 1 FROM orders WHERE order_number = ${candidate} LIMIT 1`);
    return ((result as { rows?: unknown[] }).rows?.length ?? 0) > 0;
  });
}
