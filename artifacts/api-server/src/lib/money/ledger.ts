/**
 * Double-entry money ledger.
 *
 * Every business event that moves money (an order paid, a label bought from
 * held funds, a release, a refund…) is ONE ledger transaction with two or
 * more postings that sum to zero. The database enforces the zero sum at
 * commit and rejects any UPDATE/DELETE (migration 084), and each event has a
 * deterministic idempotency key, so a replayed webhook or retried request can
 * never post twice.
 *
 * Sign convention: a posting's amount is the change in how much money is
 * attributed to that account. Money arriving from buyers is a negative
 * posting on `buyer_payments`; the same cents show up as positive postings on
 * wherever they went (seller, platform fee, Stripe fee…).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, ledgerPostings, ledgerTransactions } from "@workspace/db";
import { MoneyError } from "./fees";

export const LEDGER_ACCOUNTS = {
  /** Money paid in by buyers (negative) and refunded to them (positive). */
  buyer_payments: "buyer_payments",
  /** Preorder funds Brandthread holds for a seller (party = seller, per drop). */
  seller_held: "seller_held",
  /** Money transferred to the seller's Stripe account (party = seller). */
  seller_paid_out: "seller_paid_out",
  /** Brandthread's 5% commission. */
  platform_revenue: "platform_revenue",
  /** Stripe's processing fees. */
  stripe_processing_fees: "stripe_processing_fees",
  /** Estimated processing fee charged to the seller minus Stripe's real fee. */
  processing_fee_variance: "processing_fee_variance",
  /** Money Brandthread fronted on a seller's behalf (negative = seller owes). */
  platform_funds_advanced: "platform_funds_advanced",
  /** Paid to a manufacturer (party = manufacturer id). */
  manufacturer_paid: "manufacturer_paid",
  /** Paid to the shipping-label provider. */
  shipping_carrier: "shipping_carrier",
  /** A seller's own card paying a manufacturer sample/bulk card. */
  seller_card_payments: "seller_card_payments",
  /** Opening balances migrated from before the ledger existed. */
  legacy_opening: "legacy_opening",
} as const;
export type LedgerAccount = keyof typeof LEDGER_ACCOUNTS;

export type LedgerPosting = {
  account: LedgerAccount;
  amountCents: number;
  partyId?: string | null;
  dropId?: string | null;
  orderId?: string | null;
};

export type LedgerEntry = {
  idempotencyKey: string;
  kind: string;
  sellerId?: string | null;
  orderId?: string | null;
  dropId?: string | null;
  sampleOrderId?: string | null;
  stripeObjectId?: string | null;
  memo?: string | null;
  occurredAt?: Date;
  postings: LedgerPosting[];
};

/** Anything with drizzle's query API: the db itself or an open transaction. */
export type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

/** Validates and normalises postings; throws MoneyError on any problem. */
export function normalizePostings(postings: LedgerPosting[]): LedgerPosting[] {
  const nonZero = postings.filter((p) => p.amountCents !== 0);
  for (const p of nonZero) {
    if (!Number.isSafeInteger(p.amountCents)) {
      throw new MoneyError(`ledger posting to ${p.account} must be an integer number of cents`);
    }
    if (!(p.account in LEDGER_ACCOUNTS)) throw new MoneyError(`unknown ledger account ${p.account}`);
  }
  const sum = nonZero.reduce((total, p) => total + p.amountCents, 0);
  if (sum !== 0) throw new MoneyError(`ledger postings are unbalanced by ${sum} cents`);
  if (nonZero.length === 1) throw new MoneyError("a ledger transaction needs at least two postings");
  return nonZero;
}

/**
 * Posts one balanced ledger transaction, exactly once per idempotency key.
 * Must be called inside the same database transaction as the state change it
 * describes. Returns posted=false when the key was already posted, or when
 * every posting is zero (nothing moved).
 */
export async function postLedgerTransaction(
  executor: DbExecutor,
  entry: LedgerEntry,
): Promise<{ posted: boolean; transactionId: string | null }> {
  const postings = normalizePostings(entry.postings);
  if (postings.length === 0) return { posted: false, transactionId: null };

  const [created] = await executor.insert(ledgerTransactions).values({
    idempotencyKey: entry.idempotencyKey,
    kind: entry.kind,
    sellerId: entry.sellerId ?? null,
    orderId: entry.orderId ?? null,
    dropId: entry.dropId ?? null,
    sampleOrderId: entry.sampleOrderId ?? null,
    stripeObjectId: entry.stripeObjectId ?? null,
    memo: entry.memo ?? null,
    ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
  }).onConflictDoNothing({ target: ledgerTransactions.idempotencyKey })
    .returning({ id: ledgerTransactions.id });

  if (!created) {
    const [existing] = await executor.select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.idempotencyKey, entry.idempotencyKey))
      .limit(1);
    return { posted: false, transactionId: existing?.id ?? null };
  }

  await executor.insert(ledgerPostings).values(postings.map((p) => ({
    transactionId: created.id,
    account: p.account,
    partyId: p.partyId ?? null,
    dropId: p.dropId ?? entry.dropId ?? null,
    orderId: p.orderId === undefined ? entry.orderId ?? null : p.orderId,
    amountCents: p.amountCents,
  })));
  return { posted: true, transactionId: created.id };
}

/** Sum of an account for one party, optionally narrowed to a drop / order. */
export async function accountBalanceCents(
  executor: DbExecutor,
  filter: {
    account: LedgerAccount;
    partyId?: string;
    dropId?: string;
    orderId?: string | null;
  },
): Promise<number> {
  const conditions = [eq(ledgerPostings.account, filter.account)];
  if (filter.partyId !== undefined) conditions.push(eq(ledgerPostings.partyId, filter.partyId));
  if (filter.dropId !== undefined) conditions.push(eq(ledgerPostings.dropId, filter.dropId));
  if (filter.orderId === null) conditions.push(sql`${ledgerPostings.orderId} IS NULL`);
  else if (filter.orderId !== undefined) conditions.push(eq(ledgerPostings.orderId, filter.orderId));
  const [row] = await executor.select({
    total: sql<string>`COALESCE(SUM(${ledgerPostings.amountCents}), 0)`,
  }).from(ledgerPostings).where(and(...conditions));
  return Number(row?.total ?? 0);
}

/** Held preorder money attributed to one order (after labels / refunds). */
export function orderHeldCents(executor: DbExecutor, orderId: string, sellerId: string): Promise<number> {
  return accountBalanceCents(executor, { account: "seller_held", partyId: sellerId, orderId });
}

/**
 * Held money for a drop that is not attributed to any order: negative when
 * a bulk payment has not yet been charged to released orders, or when the
 * drop owes Brandthread after refunds.
 */
export function dropUnallocatedHeldCents(executor: DbExecutor, dropId: string, sellerId: string): Promise<number> {
  return accountBalanceCents(executor, { account: "seller_held", partyId: sellerId, dropId, orderId: null });
}

/** Checks that every ledger transaction balances. Returns offending ids. */
export async function findUnbalancedTransactions(executor: DbExecutor = db): Promise<string[]> {
  const result = await executor.execute(sql`
    SELECT transaction_id FROM ledger_postings
    GROUP BY transaction_id HAVING SUM(amount_cents) <> 0
  `);
  return (result.rows as Array<{ transaction_id: string }>).map((r) => r.transaction_id);
}
