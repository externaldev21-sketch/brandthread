/**
 * Thread Cash expiry: loads a buyer's ledger, replays it into FIFO lots
 * (lots.ts), and appends `expiry` entries for lots past their expiry.
 *
 * Idempotent by construction: every expiry entry carries the idempotency key
 * `expiry:<lot entry id>`, which the unique index on
 * thread_cash_entries(idempotency_key) allows exactly once, so the job, the
 * lazy check at redemption, and a crashed/retried run can overlap freely.
 */
import { and, eq, gt, lte, ne, sql } from "drizzle-orm";
import { db, threadCashEntries, threadCashExpiryWarnings } from "@workspace/db";
import { logger } from "../logger";
import {
  dueExpiries, expiringSoon, expiryReferenceFor, replayLots, spendableCents,
  type ExpiringSoon, type LedgerEntryLike, type Lot,
} from "./lots";
import { EXPIRY_WARNING_DAYS, activeExpiryDays } from "./rules";
import { getThreadCashConfig } from "./wallet";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export async function loadLedgerEntries(executor: DbExecutor, buyerId: string): Promise<Array<LedgerEntryLike & { note: string | null }>> {
  const rows = await executor
    .select({
      id: threadCashEntries.id,
      amountCents: threadCashEntries.amountCents,
      source: threadCashEntries.source,
      referenceId: threadCashEntries.referenceId,
      note: threadCashEntries.note,
      createdAt: threadCashEntries.createdAt,
    })
    .from(threadCashEntries)
    .where(eq(threadCashEntries.buyerId, buyerId));
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }));
}

export async function loadLots(executor: DbExecutor, buyerId: string, expiryDays: number | null): Promise<Lot[]> {
  return replayLots(await loadLedgerEntries(executor, buyerId), expiryDays);
}

/**
 * Posts the expiry entries a buyer owes at `now`. Callers hold the buyer's
 * `thread-cash-balance:<id>` advisory lock (the redeem path already does;
 * expireThreadCashForBuyer takes it). Returns the cents expired.
 */
export async function postDueExpiries(executor: DbExecutor, buyerId: string, expiryDays: number | null, now: Date): Promise<number> {
  if (expiryDays == null) return 0;
  const due = dueExpiries(await loadLots(executor, buyerId, expiryDays), now);
  let expired = 0;
  for (const lot of due) {
    const key = expiryReferenceFor(lot.entryId);
    const inserted = await executor.insert(threadCashEntries).values({
      buyerId,
      amountCents: -lot.remainingCents,
      source: "expiry",
      referenceId: key,
      idempotencyKey: key,
      note: `Expired $${(lot.remainingCents / 100).toFixed(2)} Thread Cash earned ${lot.earnedAt.toISOString().slice(0, 10)}`,
    }).onConflictDoNothing().returning({ id: threadCashEntries.id });
    if (inserted.length > 0) expired += lot.remainingCents;
  }
  return expired;
}

export async function expireThreadCashForBuyer(buyerId: string, now = new Date()): Promise<number> {
  const config = await getThreadCashConfig();
  const days = activeExpiryDays(config);
  if (days == null) return 0;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-balance:${buyerId}`}))`);
    return postDueExpiries(tx, buyerId, days, now);
  });
}

export type ThreadCashExpirySummary = {
  expiryDays: number | null;
  /** Balance that has not lapsed. Equals the ledger balance once the job has run. */
  spendableCents: number;
  expiringSoon: ExpiringSoon;
};

export async function getExpirySummary(buyerId: string, now = new Date()): Promise<ThreadCashExpirySummary> {
  const config = await getThreadCashConfig();
  const days = activeExpiryDays(config);
  const lots = await loadLots(db, buyerId, days);
  return {
    expiryDays: days,
    spendableCents: spendableCents(lots, now),
    expiringSoon: expiringSoon(lots, now, EXPIRY_WARNING_DAYS),
  };
}

const DAY_MS = 86_400_000;
const BATCH = 500;

async function candidateBuyers(from: Date | null, to: Date): Promise<string[]> {
  const conditions = [
    gt(threadCashEntries.amountCents, 0),
    ne(threadCashEntries.source, "live_gift"),
    lte(threadCashEntries.createdAt, to),
    ...(from ? [gt(threadCashEntries.createdAt, from)] : []),
  ];
  const rows = await db.selectDistinct({ buyerId: threadCashEntries.buyerId })
    .from(threadCashEntries)
    .where(and(...conditions))
    .limit(BATCH);
  return rows.map((r) => r.buyerId);
}

export type ThreadCashExpiryRun = { buyersExpired: number; expiredCents: number; warned: number };

/**
 * One pass of the scheduled job: expire what lapsed, then warn buyers whose
 * credit lapses within EXPIRY_WARNING_DAYS. Safe to run repeatedly.
 */
export async function runThreadCashExpiry(now = new Date()): Promise<ThreadCashExpiryRun> {
  const config = await getThreadCashConfig();
  const days = activeExpiryDays(config);
  const result: ThreadCashExpiryRun = { buyersExpired: 0, expiredCents: 0, warned: 0 };
  if (days == null) return result;

  // Credits at least `days` old may have lapsed.
  for (const buyerId of await candidateBuyers(null, new Date(now.getTime() - days * DAY_MS))) {
    try {
      const cents = await expireThreadCashForBuyer(buyerId, now);
      if (cents > 0) {
        result.buyersExpired += 1;
        result.expiredCents += cents;
      }
    } catch (err) {
      logger.error({ err, buyerId, job: "threadCashExpiry" }, "Thread Cash expiry failed for buyer");
    }
  }

  // Credits that lapse within the warning window: earned in
  // (now - days, now - days + warningDays].
  const windowStart = new Date(now.getTime() - days * DAY_MS);
  const windowEnd = new Date(windowStart.getTime() + EXPIRY_WARNING_DAYS * DAY_MS);
  for (const buyerId of await candidateBuyers(windowStart, windowEnd)) {
    try {
      if (await warnBuyerOfExpiry(buyerId, now)) result.warned += 1;
    } catch (err) {
      logger.error({ err, buyerId, job: "threadCashExpiry" }, "Thread Cash expiry warning failed for buyer");
    }
  }
  return result;
}

/** Warns once per buyer per upcoming-expiry day. Returns whether one was sent. */
export async function warnBuyerOfExpiry(buyerId: string, now = new Date()): Promise<boolean> {
  const summary = await getExpirySummary(buyerId, now);
  const next = summary.expiringSoon.buckets[0];
  if (!next || summary.expiringSoon.totalCents < 1) return false;
  const expiresOn = next.expiresAt.toISOString().slice(0, 10);
  const claimed = await db.insert(threadCashExpiryWarnings)
    .values({ buyerId, expiresOn, amountCents: summary.expiringSoon.totalCents })
    .onConflictDoNothing()
    .returning({ buyerId: threadCashExpiryWarnings.buyerId });
  if (claimed.length === 0) return false;

  // Imported lazily: routes/notifications-feed pulls in the whole push stack.
  const { publishNotification } = await import("../../routes/notifications-feed");
  const dollars = (summary.expiringSoon.totalCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const when = next.expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  await publishNotification({
    userId: buyerId,
    category: "finance",
    type: "thread_cash_expiring",
    title: `${dollars} Thread Cash expires soon`,
    body: `Use it by ${when} before it expires.`,
    targetId: expiresOn,
    targetType: "thread_cash",
  });
  return true;
}
