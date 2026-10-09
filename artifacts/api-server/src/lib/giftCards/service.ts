/**
 * Store gift cards: the ledger-backed core.
 *
 * Invariants
 *  - `gift_cards.balance_cents` only ever changes through a guarded atomic
 *    UPDATE (`balance_cents >= n`, active, unexpired) in the SAME transaction
 *    as the `gift_card_transactions` row that describes it. Two checkouts
 *    racing for the same card therefore can never spend more than the balance.
 *  - The ledger is append-only and every row has a unique idempotency key, so
 *    a retried request / webhook redelivery can never post twice.
 *  - Checkout uses a reserve / settle / release lifecycle keyed by the
 *    checkout session: `redeem` (reserve, balance drops), then either
 *    `settle` (payment succeeded, amount 0) or `release` (abandoned, balance
 *    returns). An order refund later posts `refund` (balance returns).
 *  - A card only redeems against its own seller's group (enforced by callers
 *    through `assertRedeemableFor`).
 *
 * Every function takes an executor so callers can run it inside their own
 * transaction. Functions that lock a card row use SELECT … FOR UPDATE.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, giftCards, giftCardTransactions } from "@workspace/db";
import type { DbExecutor } from "../money/ledger";
import { postLedgerTransaction } from "../money/ledger";
import { logger } from "../logger";
import { generateGiftCardCode, giftCardLast4, hashGiftCardCode } from "./codes";

export class GiftCardError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "GiftCardError";
  }
}

export type GiftCardRow = typeof giftCards.$inferSelect;
export type GiftCardTxRow = typeof giftCardTransactions.$inferSelect;
/** Drizzle's db or an open transaction of it. */
export type Exec = DbExecutor;

export const MIN_GIFT_CARD_CENTS = 500;
export const MAX_GIFT_CARD_CENTS = 100_000;

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

export type GiftCardStatus = "pending_payment" | "active" | "void" | "expired" | "depleted";

/** The status a buyer sees: stored status plus what is derived from expiry and balance. */
export function effectiveStatus(card: Pick<GiftCardRow, "status" | "expiresAt" | "balanceCents">, now = new Date()): GiftCardStatus {
  if (card.status === "void") return "void";
  if (card.status === "pending_payment") return "pending_payment";
  if (card.expiresAt && card.expiresAt.getTime() <= now.getTime()) return "expired";
  if (card.balanceCents <= 0) return "depleted";
  return "active";
}

export async function lockCard(exec: Exec, cardId: string): Promise<GiftCardRow | null> {
  const result = rows<{ id: string }>(await exec.execute(sql`SELECT id FROM gift_cards WHERE id = ${cardId}::uuid FOR UPDATE`));
  if (result.length === 0) return null;
  const [card] = await exec.select().from(giftCards).where(eq(giftCards.id, cardId)).limit(1);
  return card ?? null;
}

async function ledgerByKey(exec: Exec, key: string): Promise<GiftCardTxRow | null> {
  const [row] = await exec.select().from(giftCardTransactions).where(eq(giftCardTransactions.idempotencyKey, key)).limit(1);
  return row ?? null;
}

async function appendEntry(exec: Exec, entry: {
  cardId: string; type: string; amountCents: number; balanceAfterCents: number; idempotencyKey: string;
  checkoutSessionId?: string | null; orderId?: string | null; actorId?: string | null; note?: string | null;
}): Promise<GiftCardTxRow> {
  const [row] = await exec.insert(giftCardTransactions).values({
    giftCardId: entry.cardId,
    type: entry.type,
    amountCents: entry.amountCents,
    balanceAfterCents: entry.balanceAfterCents,
    checkoutSessionId: entry.checkoutSessionId ?? null,
    orderId: entry.orderId ?? null,
    actorId: entry.actorId ?? null,
    note: entry.note ?? null,
    idempotencyKey: entry.idempotencyKey,
  }).returning();
  return row;
}

// ─── Issuing ─────────────────────────────────────────────────────────────────

export type NewCardInput = {
  sellerId: string;
  amountCents: number;
  purchaserId?: string | null;
  ownerId?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  message?: string | null;
  source: "purchase" | "seller_issued";
  expiresAt?: Date | null;
  stripePaymentIntentId?: string | null;
  actorId?: string | null;
};

export function assertValidAmount(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < MIN_GIFT_CARD_CENTS || amountCents > MAX_GIFT_CARD_CENTS) {
    throw new GiftCardError(400, "INVALID_AMOUNT", "Choose an amount between $5 and $1,000.");
  }
}

/** Creates a card awaiting payment (no code yet; the code is generated when payment succeeds). */
export async function createPendingCard(exec: Exec, input: NewCardInput): Promise<GiftCardRow> {
  assertValidAmount(input.amountCents);
  const [card] = await exec.insert(giftCards).values({
    sellerId: input.sellerId,
    initialCents: input.amountCents,
    balanceCents: input.amountCents,
    purchaserId: input.purchaserId ?? null,
    ownerId: input.ownerId ?? null,
    recipientEmail: input.recipientEmail ?? null,
    recipientName: input.recipientName ?? null,
    message: input.message ?? null,
    status: "pending_payment",
    source: input.source,
    expiresAt: input.expiresAt ?? null,
    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
  }).returning();
  return card;
}

/**
 * Makes a pending card live: generates its code (returned ONCE, only its hash
 * is stored), writes the `issue` ledger row. Idempotent: returns
 * `{ code: null }` when the card was already activated (e.g. by the webhook
 * before the app's own confirm call). For purchases it also books the cash in
 * the money ledger as a gift-card liability (no money moves to the seller).
 */
export async function activateCard(
  exec: Exec,
  cardId: string,
  options: { actorId?: string | null; liabilityLedger?: boolean } = {},
): Promise<{ card: GiftCardRow; code: string | null }> {
  const card = await lockCard(exec, cardId);
  if (!card) throw new GiftCardError(404, "NOT_FOUND", "Gift card not found.");
  if (card.status !== "pending_payment") return { card, code: null };
  const code = generateGiftCardCode();
  const [activated] = await exec.update(giftCards).set({
    status: "active",
    codeHash: hashGiftCardCode(code),
    codeLast4: giftCardLast4(code),
    updatedAt: new Date(),
  }).where(and(eq(giftCards.id, cardId), eq(giftCards.status, "pending_payment"))).returning();
  if (!activated) return { card, code: null };
  await appendEntry(exec, {
    cardId, type: "issue", amountCents: card.initialCents, balanceAfterCents: card.initialCents,
    idempotencyKey: `issue/${cardId}`, actorId: options.actorId ?? card.purchaserId,
    note: card.source === "purchase" ? "Purchased" : "Issued by the store",
  });
  if (options.liabilityLedger !== false && card.source === "purchase") {
    // Brandthread holds the buyer's payment; it is owed to the seller only
    // when the card is redeemed (see payout.ts). Nothing is transferred now.
    await postLedgerTransaction(exec, {
      idempotencyKey: `gift-card-purchase/${cardId}`,
      kind: "gift_card_purchased",
      sellerId: card.sellerId,
      stripeObjectId: card.stripePaymentIntentId,
      memo: "Gift card purchased: funds held until redeemed at the store",
      postings: [
        { account: "buyer_payments", amountCents: -card.initialCents },
        { account: "gift_card_liability", partyId: card.sellerId, amountCents: card.initialCents },
      ],
    });
  }
  return { card: activated, code };
}

/**
 * Seller-issued card: live immediately, no payment, no liability (the store is
 * giving its own credit). Redeeming it is a seller-funded discount: payout.ts
 * never pays it out from Brandthread's balance.
 */
export async function issueSellerCard(exec: Exec, input: Omit<NewCardInput, "source">): Promise<{ card: GiftCardRow; code: string }> {
  const pending = await createPendingCard(exec, { ...input, source: "seller_issued" });
  const { card, code } = await activateCard(exec, pending.id, { actorId: input.actorId, liabilityLedger: false });
  return { card, code: code! };
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

export async function findCardByCode(exec: Exec, code: string): Promise<GiftCardRow | null> {
  const [card] = await exec.select().from(giftCards).where(eq(giftCards.codeHash, hashGiftCardCode(code))).limit(1);
  return card ?? null;
}

/** Throws unless the card can be spent on `sellerId`'s group right now. */
export function assertRedeemableFor(card: GiftCardRow, sellerId: string, now = new Date()): void {
  if (card.sellerId !== sellerId) {
    throw new GiftCardError(400, "GIFT_CARD_WRONG_STORE", "This gift card can only be used at the store that issued it.");
  }
  const status = effectiveStatus(card, now);
  if (status === "void") throw new GiftCardError(400, "GIFT_CARD_VOID", "This gift card is no longer valid.");
  if (status === "expired") throw new GiftCardError(400, "GIFT_CARD_EXPIRED", "This gift card has expired.");
  if (status === "depleted") throw new GiftCardError(400, "GIFT_CARD_EMPTY", "This gift card has no balance left.");
  if (status !== "active") throw new GiftCardError(400, "GIFT_CARD_INACTIVE", "This gift card isn't active yet.");
}

/** Claims an unclaimed card into the buyer's wallet. A card already claimed by someone else is refused. */
export async function claimCard(exec: Exec, cardId: string, buyerId: string): Promise<GiftCardRow> {
  const card = await lockCard(exec, cardId);
  if (!card || card.status === "pending_payment") throw new GiftCardError(404, "NOT_FOUND", "Gift card not found.");
  if (card.ownerId && card.ownerId !== buyerId) {
    throw new GiftCardError(409, "GIFT_CARD_ALREADY_CLAIMED", "This gift card was already added to another account.");
  }
  if (card.ownerId === buyerId) return card;
  const [claimed] = await exec.update(giftCards).set({ ownerId: buyerId, updatedAt: new Date() })
    .where(and(eq(giftCards.id, cardId), sql`${giftCards.ownerId} IS NULL`)).returning();
  return claimed ?? card;
}

// ─── Checkout lifecycle: reserve → settle | release ──────────────────────────

/**
 * Atomically takes `amountCents` off the card for one checkout session.
 * The UPDATE is the concurrency guard: it only succeeds while the card is
 * active, unexpired and still holds the amount, so concurrent reservations
 * cannot overspend. Idempotent per (checkout, card).
 */
export async function reserveForCheckout(exec: Exec, input: {
  cardId: string; checkoutSessionId: string; amountCents: number; actorId?: string | null; sellerId?: string;
}): Promise<{ amountCents: number; balanceAfterCents: number }> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new GiftCardError(400, "INVALID_AMOUNT", "Nothing to apply.");
  }
  const key = `redeem/${input.checkoutSessionId}/${input.cardId}`;
  const existing = await ledgerByKey(exec, key);
  if (existing) return { amountCents: -existing.amountCents, balanceAfterCents: existing.balanceAfterCents };
  const [updated] = await exec.update(giftCards).set({
    balanceCents: sql`${giftCards.balanceCents} - ${input.amountCents}`,
    updatedAt: new Date(),
  }).where(and(
    eq(giftCards.id, input.cardId),
    eq(giftCards.status, "active"),
    sql`${giftCards.balanceCents} >= ${input.amountCents}`,
    sql`(${giftCards.expiresAt} IS NULL OR ${giftCards.expiresAt} > now())`,
    ...(input.sellerId ? [eq(giftCards.sellerId, input.sellerId)] : []),
  )).returning({ balance: giftCards.balanceCents });
  if (!updated) {
    throw new GiftCardError(409, "GIFT_CARD_INSUFFICIENT", "This gift card doesn't have enough balance left.");
  }
  await appendEntry(exec, {
    cardId: input.cardId, type: "redeem", amountCents: -input.amountCents, balanceAfterCents: updated.balance,
    checkoutSessionId: input.checkoutSessionId, actorId: input.actorId ?? null, idempotencyKey: key,
    note: "Reserved at checkout",
  });
  return { amountCents: input.amountCents, balanceAfterCents: updated.balance };
}

async function redeemStates(exec: Exec, checkoutSessionId: string): Promise<Array<{ redeem: GiftCardTxRow; settled: GiftCardTxRow | null; released: GiftCardTxRow | null }>> {
  const all = await exec.select().from(giftCardTransactions)
    .where(and(eq(giftCardTransactions.checkoutSessionId, checkoutSessionId), inArray(giftCardTransactions.type, ["redeem", "settle", "release"])));
  return all.filter((row) => row.type === "redeem").map((redeem) => ({
    redeem,
    settled: all.find((r) => r.type === "settle" && r.giftCardId === redeem.giftCardId) ?? null,
    released: all.find((r) => r.type === "release" && r.giftCardId === redeem.giftCardId) ?? null,
  }));
}

/** Gift card cents reserved/settled on a checkout session, for its still-held or paid cards. */
export async function giftCentsForCheckouts(exec: Exec, checkoutSessionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (checkoutSessionIds.length === 0) return out;
  const all = await exec.select().from(giftCardTransactions)
    .where(and(inArray(giftCardTransactions.checkoutSessionId, checkoutSessionIds), inArray(giftCardTransactions.type, ["redeem", "release"])));
  for (const row of all) {
    const id = row.checkoutSessionId!;
    out.set(id, (out.get(id) ?? 0) - row.amountCents); // redeem is negative, release positive
  }
  // A released reservation nets to 0; callers treat 0 as "no gift card".
  return out;
}

export type SettledRedemption = { cardId: string; sellerId: string; amountCents: number; lateDebit: boolean };

/**
 * Payment succeeded: make the reservation final and link it to the order.
 * If the reservation had already been released (the checkout expired a moment
 * before the payment landed), the amount is re-taken from the card; if the
 * card can no longer cover it the shortfall is logged for review.
 */
export async function settleForCheckout(exec: Exec, checkoutSessionId: string, orderId: string): Promise<SettledRedemption[]> {
  const settled: SettledRedemption[] = [];
  for (const state of await redeemStates(exec, checkoutSessionId)) {
    const cardId = state.redeem.giftCardId;
    const card = await lockCard(exec, cardId);
    if (!card) continue;
    const amount = -state.redeem.amountCents;
    if (state.settled) {
      settled.push({ cardId, sellerId: card.sellerId, amountCents: amount, lateDebit: false });
      continue;
    }
    let late = false;
    if (state.released) {
      const [updated] = await exec.update(giftCards).set({
        balanceCents: sql`${giftCards.balanceCents} - ${amount}`, updatedAt: new Date(),
      }).where(and(eq(giftCards.id, cardId), sql`${giftCards.balanceCents} >= ${amount}`)).returning({ balance: giftCards.balanceCents });
      if (!updated) {
        logger.error({ cardId, checkoutSessionId, orderId, amount }, "Gift card could not cover a payment that landed after its reservation expired; needs review");
      } else {
        late = true;
        await appendEntry(exec, {
          cardId, type: "redeem", amountCents: -amount, balanceAfterCents: updated.balance, checkoutSessionId, orderId,
          idempotencyKey: `redeem-late/${checkoutSessionId}/${cardId}`, note: "Re-reserved: payment landed after the hold expired",
        });
      }
    }
    const fresh = (await exec.select().from(giftCards).where(eq(giftCards.id, cardId)).limit(1))[0];
    await appendEntry(exec, {
      cardId, type: "settle", amountCents: 0, balanceAfterCents: fresh.balanceCents, checkoutSessionId, orderId,
      idempotencyKey: `settle/${checkoutSessionId}/${cardId}`, note: "Applied to order",
    });
    settled.push({ cardId, sellerId: card.sellerId, amountCents: amount, lateDebit: late });
  }
  return settled;
}

/** Checkout abandoned / failed / expired: give every still-held reservation back. Idempotent. */
export async function releaseForCheckout(exec: Exec, checkoutSessionId: string): Promise<number> {
  let released = 0;
  for (const state of await redeemStates(exec, checkoutSessionId)) {
    if (state.settled || state.released) continue;
    const cardId = state.redeem.giftCardId;
    if (!await lockCard(exec, cardId)) continue;
    const amount = -state.redeem.amountCents;
    const [updated] = await exec.update(giftCards).set({
      balanceCents: sql`${giftCards.balanceCents} + ${amount}`, updatedAt: new Date(),
    }).where(eq(giftCards.id, cardId)).returning({ balance: giftCards.balanceCents });
    await appendEntry(exec, {
      cardId, type: "release", amountCents: amount, balanceAfterCents: updated.balance, checkoutSessionId,
      idempotencyKey: `release/${checkoutSessionId}/${cardId}`, note: "Checkout not completed",
    });
    released++;
  }
  return released;
}

/** What each card put toward an order (only settled redemptions count). */
export async function settledRedemptions(exec: Exec, orderId: string): Promise<Array<{ cardId: string; checkoutSessionId: string; amountCents: number }>> {
  const settles = await exec.select().from(giftCardTransactions)
    .where(and(eq(giftCardTransactions.orderId, orderId), eq(giftCardTransactions.type, "settle")));
  const out: Array<{ cardId: string; checkoutSessionId: string; amountCents: number }> = [];
  for (const settle of settles) {
    const redeems = await exec.select().from(giftCardTransactions).where(and(
      eq(giftCardTransactions.checkoutSessionId, settle.checkoutSessionId!),
      eq(giftCardTransactions.giftCardId, settle.giftCardId),
      eq(giftCardTransactions.type, "redeem"),
    ));
    const amount = -redeems.reduce((sum, r) => sum + r.amountCents, 0);
    if (amount > 0) out.push({ cardId: settle.giftCardId, checkoutSessionId: settle.checkoutSessionId!, amountCents: amount });
  }
  return out;
}

/** A fully refunded order gives each settled gift card its amount back. Idempotent per order + card. */
export async function refundForOrder(exec: Exec, orderId: string): Promise<Array<{ cardId: string; amountCents: number }>> {
  const refunded: Array<{ cardId: string; amountCents: number }> = [];
  for (const redemption of await settledRedemptions(exec, orderId)) {
    const { cardId, amountCents: amount } = redemption;
    const key = `refund/${orderId}/${cardId}`;
    if (await ledgerByKey(exec, key)) continue;
    if (!await lockCard(exec, cardId)) continue;
    const [updated] = await exec.update(giftCards).set({
      balanceCents: sql`${giftCards.balanceCents} + ${amount}`, updatedAt: new Date(),
    }).where(eq(giftCards.id, cardId)).returning({ balance: giftCards.balanceCents });
    await appendEntry(exec, {
      cardId, type: "refund", amountCents: amount, balanceAfterCents: updated.balance, orderId,
      checkoutSessionId: redemption.checkoutSessionId, idempotencyKey: key, note: "Order refunded",
    });
    refunded.push({ cardId, amountCents: amount });
  }
  return refunded;
}

// ─── Seller actions ──────────────────────────────────────────────────────────

/** Voids a card: its remaining balance becomes 0 (a `void` ledger row records the amount removed). */
export async function voidCard(exec: Exec, cardId: string, sellerId: string, actorId: string): Promise<GiftCardRow> {
  const card = await lockCard(exec, cardId);
  if (!card || card.sellerId !== sellerId) throw new GiftCardError(404, "NOT_FOUND", "Gift card not found.");
  if (card.status === "void") return card;
  const removed = card.balanceCents;
  const [voided] = await exec.update(giftCards).set({
    status: "void", balanceCents: 0, voidedAt: new Date(), voidedBy: actorId, updatedAt: new Date(),
  }).where(eq(giftCards.id, cardId)).returning();
  if (card.status === "active") {
    await appendEntry(exec, {
      cardId, type: "void", amountCents: -removed, balanceAfterCents: 0, actorId, idempotencyKey: `void/${cardId}`,
      note: "Voided by the store",
    });
  }
  return voided;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

export async function listBuyerCards(buyerId: string): Promise<GiftCardRow[]> {
  return db.select().from(giftCards).where(and(
    sql`(${giftCards.ownerId} = ${buyerId} OR ${giftCards.purchaserId} = ${buyerId})`,
    sql`${giftCards.status} <> 'pending_payment'`,
  )).orderBy(desc(giftCards.createdAt)).limit(200);
}

export async function listSellerCards(sellerId: string): Promise<GiftCardRow[]> {
  return db.select().from(giftCards).where(and(
    eq(giftCards.sellerId, sellerId), sql`${giftCards.status} <> 'pending_payment'`,
  )).orderBy(desc(giftCards.createdAt)).limit(500);
}

export async function listTransactions(cardId: string): Promise<GiftCardTxRow[]> {
  return db.select().from(giftCardTransactions).where(eq(giftCardTransactions.giftCardId, cardId))
    .orderBy(desc(giftCardTransactions.createdAt)).limit(100);
}

/** Public shape: never includes the hash or the recipient's email to other parties. */
export function presentCard(card: GiftCardRow, role: "owner" | "purchaser" | "seller") {
  return {
    id: card.id,
    sellerId: card.sellerId,
    last4: card.codeLast4,
    initialCents: card.initialCents,
    balanceCents: card.balanceCents,
    currency: card.currency,
    status: effectiveStatus(card),
    expiresAt: card.expiresAt,
    createdAt: card.createdAt,
    role,
    recipientName: card.recipientName,
    ...(role === "seller" || role === "purchaser" ? { recipientEmail: card.recipientEmail } : {}),
    message: card.message,
  };
}
