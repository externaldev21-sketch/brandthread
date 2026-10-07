/**
 * Thread Cash funding: which money a balance is made of.
 *
 *   promo — platform-funded rewards (daily check-ins, streak bonuses, admin
 *           credit, refunds of promo spend). Spendable in Brandthread, never
 *           withdrawable, and it stays promo when a buyer gifts it to a
 *           seller.
 *   paid  — money a buyer actually paid for Thread Cash. There is no
 *           purchase source yet (migration 306 backfilled everything as
 *           promo); a future one only has to write `funding: 'paid'`.
 *
 * Every row of thread_cash_entries carries one funding. Rules:
 *  - Spending (checkout redemption, sends, live gifts) uses PROMO FIRST, so a
 *    buyer's paid money is only consumed once their promo credit is gone, and
 *    a seller spending in the app keeps as much withdrawable money as possible.
 *  - A debit is still one row (its key/token/amount semantics are unchanged).
 *    When it consumed both kinds, a zero-sum `funding_shift` pair records the
 *    paid part (paid −p / promo +p), referenced as `shift:<row id>` and hidden
 *    from history.
 *  - A gift or claimed send credits the receiver with exactly the funding the
 *    sender's debit consumed (two rows when mixed).
 *  - Reversals (cancelled redemption/send, expiry) restore exactly what was
 *    consumed; a refund of checkout spend restores paid first.
 *  - Withdrawable (cashable) = min(balance, paid balance, paid received from
 *    others − paid cashed out). Promo is never cashable; cash-outs debit paid.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, threadCashEntries } from "@workspace/db";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;
type NewEntry = typeof threadCashEntries.$inferInsert;

export type ThreadCashFunding = "promo" | "paid";
export type FundingSplit = { promoCents: number; paidCents: number };

export const FUNDING_SHIFT_SOURCE = "funding_shift";
/** Credits from other people: the only paid money a seller may withdraw. */
export const EARNED_SOURCES = ["live_gift", "send_received"] as const;

export type FundingBalances = {
  balanceCents: number;
  promoCents: number;
  paidCents: number;
  /** Withdrawable: paid money received from others, not yet cashed out or spent. */
  cashableCents: number;
};

export async function getFundingBalances(executor: DbExecutor, userId: string): Promise<FundingBalances> {
  const [row] = await executor.select({
    balance: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}), 0)`,
    promo: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.funding} = 'promo'), 0)`,
    paid: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.funding} = 'paid'), 0)`,
    paidEarned: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.funding} = 'paid' AND ${threadCashEntries.source} IN ('live_gift', 'send_received')), 0)`,
    paidCashedOut: sql<string>`COALESCE(SUM(-${threadCashEntries.amountCents}) FILTER (WHERE ${threadCashEntries.funding} = 'paid' AND ${threadCashEntries.source} = 'cash_out'), 0)`,
  }).from(threadCashEntries).where(eq(threadCashEntries.buyerId, userId));
  const balanceCents = Number(row?.balance ?? 0);
  const promoCents = Math.max(0, Number(row?.promo ?? 0));
  const paidCents = Math.max(0, Number(row?.paid ?? 0));
  const earnedLeft = Number(row?.paidEarned ?? 0) - Number(row?.paidCashedOut ?? 0);
  const cashableCents = Math.max(0, Math.min(balanceCents, paidCents, earnedLeft));
  return { balanceCents, promoCents, paidCents, cashableCents };
}

/** Promo first, paid last. */
export function splitPromoFirst(amountCents: number, balances: Pick<FundingBalances, "promoCents">): FundingSplit {
  const promoCents = Math.min(amountCents, Math.max(0, balances.promoCents));
  return { promoCents, paidCents: amountCents - promoCents };
}

function primaryFunding(split: FundingSplit): ThreadCashFunding {
  return split.promoCents === 0 && split.paidCents > 0 ? "paid" : "promo";
}

async function insertShift(tx: DbExecutor, buyerId: string, primaryId: string, paidDelta: number): Promise<void> {
  await tx.insert(threadCashEntries).values([
    { buyerId, amountCents: paidDelta, source: FUNDING_SHIFT_SOURCE, referenceId: `shift:${primaryId}`, funding: "paid", note: "Paid Thread Cash part of this entry" },
    { buyerId, amountCents: -paidDelta, source: FUNDING_SHIFT_SOURCE, referenceId: `shift:${primaryId}`, funding: "promo", note: "Paid Thread Cash part of this entry" },
  ]);
}

/**
 * One debit row of `amountCents` (stored negative) that consumed `split`;
 * a mixed split adds the zero-sum funding_shift pair. Returns the row.
 */
export async function insertDebitEntry(
  tx: DbExecutor,
  values: Omit<NewEntry, "amountCents" | "funding">,
  amountCents: number,
  split: FundingSplit,
) {
  const [row] = await tx.insert(threadCashEntries).values({
    ...values, amountCents: -amountCents, funding: primaryFunding(split),
  }).returning();
  if (split.promoCents > 0 && split.paidCents > 0) await insertShift(tx, values.buyerId, row.id, -split.paidCents);
  return row;
}

/** One credit row restoring `split` (a reversal of an earlier debit). */
export async function insertRestoreEntry(
  tx: DbExecutor,
  values: Omit<NewEntry, "amountCents" | "funding">,
  split: FundingSplit,
) {
  const amountCents = split.promoCents + split.paidCents;
  const [row] = await tx.insert(threadCashEntries).values({
    ...values, amountCents, funding: primaryFunding(split),
  }).returning();
  if (split.promoCents > 0 && split.paidCents > 0) await insertShift(tx, values.buyerId, row.id, split.paidCents);
  return row;
}

/** Credit rows for a receiver, one per funding (gifts and claimed sends). */
export async function insertCreditRows(
  tx: DbExecutor,
  values: Omit<NewEntry, "amountCents" | "funding">,
  split: FundingSplit,
): Promise<void> {
  const parts: Array<[ThreadCashFunding, number]> = [["promo", split.promoCents], ["paid", split.paidCents]];
  const toInsert = parts.filter(([, cents]) => cents > 0)
    .map(([funding, cents]) => ({ ...values, amountCents: cents, funding }));
  if (toInsert.length) await tx.insert(threadCashEntries).values(toInsert);
}

/** Which funds an earlier single-row entry (debit or restore) moved. */
export async function entrySplit(
  executor: DbExecutor,
  row: { id: string; amountCents: number; funding: string },
): Promise<FundingSplit> {
  const total = Math.abs(row.amountCents);
  if (row.funding === "paid") return { promoCents: 0, paidCents: total };
  const [shift] = await executor.select({
    paid: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}), 0)`,
  }).from(threadCashEntries).where(and(
    eq(threadCashEntries.source, FUNDING_SHIFT_SOURCE),
    eq(threadCashEntries.referenceId, `shift:${row.id}`),
    eq(threadCashEntries.funding, "paid"),
  ));
  const paidCents = Math.min(total, Math.abs(Number(shift?.paid ?? 0)));
  return { promoCents: total - paidCents, paidCents };
}
