/**
 * Hold-until-delivered: when a seller's money may leave the platform.
 *
 * With PAYOUT_MODE=hold (the default) an order that carries a delivery
 * deadline (every order paid after migration 110) is released to the seller
 * only when ALL of these hold:
 *   - it is delivered (carrier-confirmed or buyer-confirmed),
 *   - the buffer after delivery has passed (payout_release_at),
 *   - no chargeback is open (dispute_paused_at),
 *   - no return is open.
 * That is what makes an automatic refund free for the platform: until then
 * the money is still on Brandthread's own Stripe balance.
 *
 * Orders without a deadline (paid before the guarantee existed) and every
 * order under PAYOUT_MODE=immediate keep the old timing.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import type { DbExecutor } from "../money/ledger";
import { payoutMode } from "./policy";

type Gated = {
  deliverBy: Date | null;
  deliveredAt: Date | null;
  payoutReleaseAt: Date | null;
  disputePausedAt: Date | null;
};

export function payoutHoldApplies(order: Pick<Gated, "deliverBy">, env: NodeJS.ProcessEnv = process.env): boolean {
  return payoutMode(env) === "hold" && order.deliverBy !== null;
}

export function payoutTimeReached(order: Gated, now: Date): boolean {
  return Boolean(order.deliveredAt)
    && Boolean(order.payoutReleaseAt)
    && order.payoutReleaseAt!.valueOf() <= now.valueOf()
    && !order.disputePausedAt;
}

export async function hasOpenReturn(executor: DbExecutor | typeof db, orderId: string): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT 1 FROM returns WHERE order_id = ${orderId}::uuid AND status IN ('pending', 'approved') LIMIT 1
  `);
  return ((result as { rows?: unknown[] }).rows ?? []).length > 0;
}

/** Everything the gate needs, for one order. */
export async function payoutMayRelease(
  executor: DbExecutor | typeof db,
  order: Gated & { id: string },
  now: Date,
): Promise<boolean> {
  if (!payoutHoldApplies(order)) return true;
  return payoutTimeReached(order, now) && !(await hasOpenReturn(executor, order.id));
}

/** SQL twin of payoutMayRelease for sweeps; `o` is the orders alias. */
export function payoutReleasableSql(now: Date, alias = "o"): SQL {
  const o = sql.raw(alias);
  if (payoutMode() !== "hold") return sql`TRUE`;
  return sql`(
    ${o}.deliver_by IS NULL
    OR (
      ${o}.delivered_at IS NOT NULL AND ${o}.payout_release_at <= ${now}
      AND ${o}.dispute_paused_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = ${o}.id AND r.status IN ('pending', 'approved'))
    )
  )`;
}
