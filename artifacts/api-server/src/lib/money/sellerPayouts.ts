/**
 * Seller payouts (connected account → seller's bank), fed by Stripe Connect
 * webhooks.
 *
 * seller_payouts is the source of truth for payout status. Webhook events
 * payout.created / updated / paid / failed / canceled on a connected account
 * (event.account set) upsert one row per Stripe payout. Each row remembers
 * the event.created of the newest event applied, so a late, older event can
 * never move a payout backwards (e.g. a delayed payout.updated "in_transit"
 * after payout.paid).
 *
 * Before webhooks have covered an account (old history, or a seller who has
 * not had a payout event yet), the finance routes back the table up once from
 * stripe.payouts.list and remember that in seller_payout_syncs; after that
 * every read comes from the table.
 *
 * A payout event that matches a cash-out request (seller_cashout_attempts by
 * payout id, or by the metadata Brandthread put on the payout) reconciles that
 * request's status too.
 */
import type Stripe from "stripe";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, sellerCashoutAttempts, sellerPayouts, sellerPayoutSyncs, users } from "@workspace/db";
import { logger } from "../logger";
import { publishNotification } from "../../routes/notifications-feed";

export const SELLER_PAYOUT_STATUSES = ["pending", "in_transit", "paid", "failed", "canceled"] as const;
export type SellerPayoutStatus = (typeof SELLER_PAYOUT_STATUSES)[number];

/** Connect payout events handled by recordSellerPayoutEvent. */
export const SELLER_PAYOUT_EVENT_TYPES = [
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
] as const;

export type SellerPayoutRow = typeof sellerPayouts.$inferSelect;

export function isSellerPayoutStatus(value: unknown): value is SellerPayoutStatus {
  return typeof value === "string" && (SELLER_PAYOUT_STATUSES as readonly string[]).includes(value);
}

// At the same event second, a final status wins over an in-flight one.
// paid → failed is a real Stripe transition, but it always arrives as a
// later event, so it is decided by time, not by rank.
function statusRank(status: string): number {
  if (status === "pending") return 0;
  if (status === "in_transit") return 1;
  return 2;
}

/** Whether an observation at `observedAt` with `status` should replace `existing`. */
export function supersedes(
  existing: { lastEventCreated: Date; status: string },
  observedAt: Date,
  status: string,
): boolean {
  const delta = observedAt.valueOf() - existing.lastEventCreated.valueOf();
  if (delta !== 0) return delta > 0;
  return statusRank(status) >= statusRank(existing.status);
}

type PayoutFields = Omit<typeof sellerPayouts.$inferInsert, "id" | "createdAt" | "updatedAt" | "lastEventCreated">;

function toDate(unixSeconds: unknown): Date | null {
  return typeof unixSeconds === "number" && Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000) : null;
}

/** Stripe payout object → seller_payouts columns. Null when it is not a usable payout. */
export function payoutFields(payout: any, stripeAccountId: string, sellerId: string | null): PayoutFields | null {
  if (!payout || typeof payout.id !== "string" || !isSellerPayoutStatus(payout.status)) return null;
  if (!Number.isSafeInteger(payout.amount)) return null;
  const destination = payout.destination && typeof payout.destination === "object" ? payout.destination : null;
  return {
    stripePayoutId: payout.id,
    stripeAccountId,
    sellerId,
    amountCents: payout.amount,
    currency: typeof payout.currency === "string" ? payout.currency.toLowerCase() : "usd",
    status: payout.status,
    method: typeof payout.method === "string" ? payout.method : null,
    automatic: typeof payout.automatic === "boolean" ? payout.automatic : null,
    description: typeof payout.description === "string" ? payout.description : null,
    arrivalDate: toDate(payout.arrival_date),
    failureCode: typeof payout.failure_code === "string" ? payout.failure_code : null,
    failureMessage: typeof payout.failure_message === "string" ? payout.failure_message : null,
    destinationLast4: typeof destination?.last4 === "string" ? destination.last4 : null,
    destinationBrand: typeof (destination?.brand ?? destination?.bank_name) === "string"
      ? (destination.brand ?? destination.bank_name)
      : null,
    payoutCreatedAt: toDate(payout.created),
  };
}

export type UpsertResult = {
  /** False when the stored row is newer than this observation (ignored). */
  applied: boolean;
  previousStatus: SellerPayoutStatus | null;
  row: SellerPayoutRow;
};

/**
 * Inserts or updates one payout, unless the stored row already reflects a
 * newer observation. Safe under concurrent deliveries (row lock).
 */
export async function upsertSellerPayout(fields: PayoutFields, observedAt: Date): Promise<UpsertResult> {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(sellerPayouts)
      .values({ ...fields, lastEventCreated: observedAt })
      .onConflictDoNothing({ target: sellerPayouts.stripePayoutId })
      .returning();
    if (inserted[0]) return { applied: true, previousStatus: null, row: inserted[0] };

    const [existing] = await tx.select().from(sellerPayouts)
      .where(eq(sellerPayouts.stripePayoutId, fields.stripePayoutId))
      .limit(1)
      .for("update");
    const previousStatus = isSellerPayoutStatus(existing.status) ? existing.status : null;
    if (!supersedes(existing, observedAt, fields.status)) {
      return { applied: false, previousStatus, row: existing };
    }
    const [row] = await tx.update(sellerPayouts)
      .set({
        ...fields,
        // Webhook payloads carry the destination as an id only; keep the
        // bank details an expanded API read stored earlier.
        sellerId: fields.sellerId ?? existing.sellerId,
        destinationLast4: fields.destinationLast4 ?? existing.destinationLast4,
        destinationBrand: fields.destinationBrand ?? existing.destinationBrand,
        method: fields.method ?? existing.method,
        automatic: fields.automatic ?? existing.automatic,
        lastEventCreated: observedAt,
        updatedAt: new Date(),
      })
      .where(eq(sellerPayouts.id, existing.id))
      .returning();
    return { applied: true, previousStatus, row };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mirrors a payout's status onto the cash-out request that created it.
 * "succeeded" there means Stripe accepted the payout; a failed or canceled
 * payout turns the request into "failed" with Stripe's reason.
 */
export async function reconcileCashoutAttempt(payout: any, row: SellerPayoutRow): Promise<boolean> {
  const metadataAttempt = payout?.metadata?.brandthread_cashout_attempt;
  const byMetadata = typeof metadataAttempt === "string" && UUID.test(metadataAttempt)
    ? eq(sellerCashoutAttempts.id, metadataAttempt)
    : undefined;
  const match = byMetadata
    ? or(eq(sellerCashoutAttempts.stripePayoutId, row.stripePayoutId), byMetadata)
    : eq(sellerCashoutAttempts.stripePayoutId, row.stripePayoutId);
  const [candidate] = await db.select({ id: sellerCashoutAttempts.id, ownerId: sellerCashoutAttempts.ownerId })
    .from(sellerCashoutAttempts)
    .where(and(match, eq(sellerCashoutAttempts.stripeAccountId, row.stripeAccountId)))
    .limit(1);
  if (!candidate) return false;

  const failed = row.status === "failed" || row.status === "canceled";
  await db.transaction(async (tx) => {
    // Same lock as POST /api/finance/payout, so a cash-out still writing its
    // own result cannot overwrite this newer status afterwards.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${candidate.ownerId}))`);
    await tx.update(sellerCashoutAttempts)
      .set(failed
        ? {
            status: "failed",
            stripePayoutId: row.stripePayoutId,
            responseStatus: row.status,
            responseArrivalDate: row.arrivalDate,
            errorHttpStatus: null,
            errorCode: row.failureCode ?? `payout_${row.status}`,
            errorMessage: row.failureMessage
              ?? (row.status === "canceled" ? "The payout was canceled" : "The payout failed"),
            updatedAt: new Date(),
          }
        : {
            status: "succeeded",
            stripePayoutId: row.stripePayoutId,
            responseStatus: row.status,
            responseArrivalDate: row.arrivalDate,
            errorHttpStatus: null,
            errorCode: null,
            errorMessage: null,
            updatedAt: new Date(),
          })
      .where(eq(sellerCashoutAttempts.id, candidate.id));
  });
  return true;
}

function formatAmount(cents: number, currency: string): string {
  const upper = currency.toUpperCase();
  return upper === "USD" ? `$${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)} ${upper}`;
}

async function notifyPayoutFailed(sellerId: string, row: SellerPayoutRow): Promise<void> {
  const reason = row.failureMessage ? ` ${row.failureMessage.replace(/\.?$/, ".")}` : "";
  try {
    await publishNotification({
      userId: sellerId,
      category: "orders",
      type: "payout_failed",
      title: "Payout failed",
      body: `${formatAmount(row.amountCents, row.currency)} couldn't be sent to your bank account.${reason} `
        + "The money is back in your balance. Check your bank details in Payouts.",
      targetId: row.stripePayoutId,
      targetType: "payout",
      cta: "View payouts",
      pushCategory: "payout",
    });
  } catch (err) {
    logger.error({ err, payoutId: row.stripePayoutId }, "Seller payout failed notification failed");
  }
}

async function sellerForAccount(stripeAccountId: string): Promise<string | null> {
  const [seller] = await db.select({ clerkId: users.clerkId })
    .from(users)
    .where(eq(users.stripeAccountId, stripeAccountId))
    .limit(1);
  return seller?.clerkId ?? null;
}

export type PayoutEventResult = UpsertResult & { sellerId: string | null };

/**
 * Applies one Connect payout.* webhook event. Platform payouts (no
 * event.account) are not seller payouts and are ignored. Throws on database
 * errors so the webhook is marked failed and Stripe retries.
 */
export async function recordSellerPayoutEvent(event: {
  id?: string;
  type: string;
  created: number;
  account?: string | null;
  data: { object: any };
}): Promise<PayoutEventResult | null> {
  const stripeAccountId = event.account;
  if (!stripeAccountId) return null;
  const payout = event.data.object;
  const sellerId = await sellerForAccount(stripeAccountId);
  const fields = payoutFields(payout, stripeAccountId, sellerId);
  if (!fields) {
    logger.warn({ eventId: event.id, type: event.type, status: payout?.status }, "Unusable payout event ignored");
    return null;
  }
  const observedAt = new Date(event.created * 1000);
  const result = await upsertSellerPayout(fields, observedAt);
  if (!result.applied) {
    logger.info(
      { eventId: event.id, payoutId: fields.stripePayoutId, stored: result.row.status, incoming: fields.status },
      "Out-of-order payout event ignored",
    );
    return { ...result, sellerId };
  }

  await reconcileCashoutAttempt(payout, result.row);

  if (result.row.status === "failed" && result.previousStatus !== "failed" && sellerId) {
    await notifyPayoutFailed(sellerId, result.row);
  }
  return { ...result, sellerId };
}

// ─── Reads for the finance routes ────────────────────────────────────────────

/** A seller_payouts row in the shape of a Stripe payout (what the routes already map). */
export type PayoutLike = {
  id: string;
  amount: number;
  currency: string;
  status: SellerPayoutStatus;
  arrival_date: number;
  created: number;
  description: string | null;
  failure_code: string | null;
  failure_message: string | null;
  method: string | null;
  automatic: boolean | null;
  destination: { last4: string | null; brand: string | null } | null;
};

const seconds = (date: Date | null, fallback: Date) => Math.floor((date ?? fallback).valueOf() / 1000);

export function toPayoutLike(row: SellerPayoutRow): PayoutLike {
  return {
    id: row.stripePayoutId,
    amount: row.amountCents,
    currency: row.currency,
    status: isSellerPayoutStatus(row.status) ? row.status : "pending",
    arrival_date: seconds(row.arrivalDate, row.createdAt),
    created: seconds(row.payoutCreatedAt, row.createdAt),
    description: row.description,
    failure_code: row.failureCode,
    failure_message: row.failureMessage,
    method: row.method,
    automatic: row.automatic,
    destination: row.destinationLast4 || row.destinationBrand
      ? { last4: row.destinationLast4, brand: row.destinationBrand }
      : null,
  };
}

/** Upserts a payout read from the Stripe API (observed now). */
export async function upsertPayoutFromApi(
  payout: Stripe.Payout | any,
  stripeAccountId: string,
  sellerId: string | null,
  observedAt = new Date(),
): Promise<UpsertResult | null> {
  const fields = payoutFields(payout, stripeAccountId, sellerId);
  if (!fields) return null;
  return upsertSellerPayout(fields, observedAt);
}

const BACKFILL_PAGES = 5; // x100 payouts

type PayoutListClient = { payouts: { list: (params: any, options: any) => Promise<{ data: any[]; has_more: boolean }> } };

/**
 * Makes sure seller_payouts holds this account's payout history. The first
 * call per account copies it from the Stripe API (the only Stripe read);
 * later calls are a single indexed lookup.
 */
export async function ensureSellerPayoutsSynced(input: {
  stripe: PayoutListClient;
  stripeAccountId: string;
  sellerId: string | null;
}): Promise<"table" | "backfilled"> {
  const [synced] = await db.select({ id: sellerPayoutSyncs.id })
    .from(sellerPayoutSyncs)
    .where(eq(sellerPayoutSyncs.stripeAccountId, input.stripeAccountId))
    .limit(1);
  if (synced) return "table";

  // Read time, not payout time: anything an event says after this wins.
  const observedAt = new Date();
  let startingAfter: string | undefined;
  for (let page = 0; page < BACKFILL_PAGES; page += 1) {
    const result = await input.stripe.payouts.list(
      { limit: 100, expand: ["data.destination"], ...(startingAfter ? { starting_after: startingAfter } : {}) },
      { stripeAccount: input.stripeAccountId },
    );
    for (const payout of result.data) {
      await upsertPayoutFromApi(payout, input.stripeAccountId, input.sellerId, observedAt);
    }
    if (!result.has_more || result.data.length === 0) break;
    startingAfter = result.data[result.data.length - 1]?.id;
  }
  await db.insert(sellerPayoutSyncs)
    .values({ stripeAccountId: input.stripeAccountId, sellerId: input.sellerId })
    .onConflictDoNothing({ target: sellerPayoutSyncs.stripeAccountId });
  return "backfilled";
}

/** Newest-first payouts for an account, like stripe.payouts.list. */
export async function listSellerPayouts(input: {
  stripe: PayoutListClient;
  stripeAccountId: string;
  sellerId: string | null;
  limit: number;
  status?: SellerPayoutStatus;
}): Promise<{ data: PayoutLike[]; has_more: boolean; source: "table" | "backfilled" }> {
  const source = await ensureSellerPayoutsSynced(input);
  const rows = await db.select().from(sellerPayouts)
    .where(and(
      eq(sellerPayouts.stripeAccountId, input.stripeAccountId),
      input.status ? eq(sellerPayouts.status, input.status) : undefined,
    ))
    .orderBy(desc(sql`COALESCE(${sellerPayouts.payoutCreatedAt}, ${sellerPayouts.createdAt})`), desc(sellerPayouts.id))
    .limit(input.limit + 1);
  return {
    data: rows.slice(0, input.limit).map(toPayoutLike),
    has_more: rows.length > input.limit,
    source,
  };
}

/** Total paid to the seller's bank in `currency` (all synced payouts). */
export async function paidToBankCents(input: {
  stripe: PayoutListClient;
  stripeAccountId: string;
  sellerId: string | null;
  currency: string;
}): Promise<number> {
  await ensureSellerPayoutsSynced(input);
  const [row] = await db.select({ total: sql<string>`COALESCE(SUM(${sellerPayouts.amountCents}), 0)` })
    .from(sellerPayouts)
    .where(and(
      eq(sellerPayouts.stripeAccountId, input.stripeAccountId),
      eq(sellerPayouts.status, "paid"),
      eq(sellerPayouts.currency, input.currency),
    ));
  return Number(row?.total ?? 0);
}

/** Money on its way to the seller's bank (pending + in_transit payouts), from the table only. */
export async function inFlightPayoutCents(sellerId: string, currency = "usd"): Promise<number> {
  const [row] = await db.select({ total: sql<string>`COALESCE(SUM(${sellerPayouts.amountCents}), 0)` })
    .from(sellerPayouts)
    .where(and(
      eq(sellerPayouts.sellerId, sellerId),
      inArray(sellerPayouts.status, ["pending", "in_transit"]),
      eq(sellerPayouts.currency, currency),
    ));
  return Number(row?.total ?? 0);
}

/** Latest payouts for a seller, from the table only (support context). */
export async function recentSellerPayouts(sellerId: string, limit = 5): Promise<SellerPayoutRow[]> {
  return db.select().from(sellerPayouts)
    .where(eq(sellerPayouts.sellerId, sellerId))
    .orderBy(desc(sql`COALESCE(${sellerPayouts.payoutCreatedAt}, ${sellerPayouts.createdAt})`))
    .limit(limit);
}
