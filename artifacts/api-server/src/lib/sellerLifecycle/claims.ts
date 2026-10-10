/**
 * Exactly-once claims for seller lifecycle messages. Inserting the
 * (seller, kind, period) row is the claim: the unique index lets only one
 * caller (one API instance, one job tick) win, so nothing is sent twice.
 */
import { and, eq } from "drizzle-orm";
import { db, sellerLifecycleMessages } from "@workspace/db";

export async function claimLifecycleMessage(sellerId: string, kind: string, periodKey: string): Promise<boolean> {
  const rows = await db.insert(sellerLifecycleMessages)
    .values({ sellerId, kind, periodKey })
    .onConflictDoNothing()
    .returning({ id: sellerLifecycleMessages.id });
  return rows.length > 0;
}

export async function markLifecycleDelivered(
  sellerId: string, kind: string, periodKey: string, delivered: { push?: boolean; email?: boolean },
): Promise<void> {
  await db.update(sellerLifecycleMessages)
    .set({
      ...(delivered.push !== undefined ? { pushSent: delivered.push } : {}),
      ...(delivered.email !== undefined ? { emailSent: delivered.email } : {}),
    })
    .where(and(
      eq(sellerLifecycleMessages.sellerId, sellerId),
      eq(sellerLifecycleMessages.kind, kind),
      eq(sellerLifecycleMessages.periodKey, periodKey),
    ));
}

/** UTC calendar day, e.g. 2026-10-10. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
