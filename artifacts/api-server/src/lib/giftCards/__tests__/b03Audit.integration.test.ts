/**
 * Audit regressions (slice B03): a payment that lands after its gift card
 * hold was released must count the card ONCE — for the seller's payout
 * (settledRedemptions) and for a refund (refundForOrder) — and not at all
 * when the card could no longer cover the late re-take.
 */
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, giftCards } from "@workspace/db";
import {
  activateCard, createPendingCard, refundForOrder, releaseForCheckout, reserveForCheckout, settleForCheckout, settledRedemptions,
} from "../service";

const sellerId = `gc-b03-seller-${crypto.randomUUID()}`;

async function card(amountCents: number) {
  const pending = await createPendingCard(db, { sellerId, amountCents, source: "purchase", purchaserId: "gc-b03-buyer" });
  return (await db.transaction((tx) => activateCard(tx, pending.id, { liabilityLedger: false }))).card;
}

async function balanceOf(cardId: string) {
  const [row] = await db.select({ balance: giftCards.balanceCents }).from(giftCards).where(eq(giftCards.id, cardId));
  return row.balance;
}

describe("late payment after a released gift card hold", () => {
  it("re-taken once: the order counts the card once and a refund gives it back once", async () => {
    const c = await card(2_000);
    const cs = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: c.id, checkoutSessionId: cs, amountCents: 2_000 }));
    await db.transaction((tx) => releaseForCheckout(tx, cs));
    const settled = await db.transaction((tx) => settleForCheckout(tx, cs, orderId));
    expect(settled).toEqual([expect.objectContaining({ amountCents: 2_000, lateDebit: true })]);
    expect(await balanceOf(c.id)).toBe(0);

    // A webhook redelivery settles the same card once, not once per redeem row.
    expect(await db.transaction((tx) => settleForCheckout(tx, cs, orderId))).toHaveLength(1);

    expect(await settledRedemptions(db, orderId)).toEqual([{ cardId: c.id, checkoutSessionId: cs, amountCents: 2_000 }]);
    await db.transaction((tx) => refundForOrder(tx, orderId));
    expect(await balanceOf(c.id)).toBe(2_000); // never more than the card ever held
  });

  it("not re-taken (the card was spent meanwhile): the order counts nothing from the card", async () => {
    const c = await card(2_000);
    const cs = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: c.id, checkoutSessionId: cs, amountCents: 2_000 }));
    await db.transaction((tx) => releaseForCheckout(tx, cs));
    const other = crypto.randomUUID();
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: c.id, checkoutSessionId: other, amountCents: 2_000 }));
    await db.transaction((tx) => settleForCheckout(tx, other, crypto.randomUUID()));

    const settled = await db.transaction((tx) => settleForCheckout(tx, cs, orderId));
    expect(settled).toEqual([expect.objectContaining({ lateDebit: false })]);
    expect(await settledRedemptions(db, orderId)).toEqual([]);
    expect(await db.transaction((tx) => refundForOrder(tx, orderId))).toEqual([]);
    expect(await balanceOf(c.id)).toBe(0);
  });
});
