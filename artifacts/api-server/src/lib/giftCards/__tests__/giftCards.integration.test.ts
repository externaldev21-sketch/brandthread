/**
 * Store gift cards against real Postgres + the in-memory Stripe:
 *  - ledger core: issue, partial redemption, reserve/settle/release, refund,
 *    void, expiry, wrong store, idempotency, append-only;
 *  - concurrency: parallel reservations can never spend more than the balance;
 *  - buying: PaymentIntent on Brandthread's balance, code shown once, hashed
 *    at rest, emailed, no money moved to the seller at purchase;
 *  - checkout: the card covers part of ITS store's group only, the seller is
 *    still paid in full (supplemental transfer), abandoned checkouts free the
 *    card, a full refund gives it back and reverses the seller's gift payout;
 *  - code lookups are rate limited.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
  normalizePushEventCategory: () => "orders",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
  sendBrandthreadEmail: async (mail: { to: string; subject: string; html: string }) => {
    sentEmails.push(mail);
    return true;
  },
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { db, checkoutSessions, giftCards, giftCardTransactions, ledgerTransactions, orders } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { fake } from "../../money/__tests__/fakeStripe";
import { handleCartPaymentEnded, handleCartPaymentSucceeded } from "../../../routes/webhooks";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import giftCardsRouter from "../../../routes/gift-cards";
import { refundOrder } from "../../money/refunds";
import { expireStockReservations } from "../../money/cartTransfers";
import {
  call, expectLedgerBalanced, orderLedger, seedBuyer, seedProduct, seedSeller, startApp, uid,
} from "../../money/__tests__/moneyHarness";
import { hashGiftCardCode } from "../codes";
import {
  GiftCardError, activateCard, claimCard, createPendingCard, issueSellerCard, refundForOrder, releaseForCheckout,
  reserveForCheckout, settleForCheckout, voidCard,
} from "../service";
import { saveGiftCardSettings } from "../settings";
import { confirmGiftCardPurchase, createGiftCardPurchase, handleGiftCardPaymentSucceeded } from "../purchase";
import { payoutSellerForOrder } from "../payout";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    server.use("/api/gift-cards", giftCardsRouter);
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(() => {
  fake.reset();
  sentEmails.length = 0;
});

/** A fresh checkout_sessions row to hang a reservation on. */
async function checkoutRow(buyerId: string, sellerId: string) {
  const [row] = await db.insert(checkoutSessions).values({ buyerId, sellerId, items: [], chargeModel: "transfer" }).returning();
  return row.id;
}

async function issue(sellerId: string, amountCents: number, ownerId: string | null = null) {
  const { card, code } = await db.transaction((tx) => issueSellerCard(tx, {
    sellerId, amountCents, ownerId, recipientEmail: "friend@test.local", actorId: sellerId,
  }));
  return { card, code };
}

async function balanceOf(cardId: string): Promise<number> {
  const [row] = await db.select({ balance: giftCards.balanceCents }).from(giftCards).where(eq(giftCards.id, cardId)).limit(1);
  return row.balance;
}

async function ledgerOf(cardId: string) {
  return db.select().from(giftCardTransactions).where(eq(giftCardTransactions.giftCardId, cardId)).orderBy(giftCardTransactions.createdAt);
}

describe("issuing", () => {
  it("stores only the hash and last 4 of the code, and writes an issue ledger row", async () => {
    const seller = await seedSeller("issue");
    const { card, code } = await issue(seller, 5_000);
    expect(card.status).toBe("active");
    expect(card.codeHash).toBe(hashGiftCardCode(code));
    expect(card.codeLast4).toBe(code.replace(/-/g, "").slice(-4));
    expect(JSON.stringify(card)).not.toContain(code);
    const rows = await ledgerOf(card.id);
    expect(rows.map((r) => [r.type, r.amountCents, r.balanceAfterCents])).toEqual([["issue", 5_000, 5_000]]);
  });

  it("activating twice returns the code only once", async () => {
    const seller = await seedSeller("activate");
    const pending = await createPendingCard(db, { sellerId: seller, amountCents: 2_500, source: "purchase", purchaserId: "x" });
    const first = await db.transaction((tx) => activateCard(tx, pending.id, { liabilityLedger: false }));
    const second = await db.transaction((tx) => activateCard(tx, pending.id, { liabilityLedger: false }));
    expect(first.code).toBeTruthy();
    expect(second.code).toBeNull();
    expect(await ledgerOf(pending.id)).toHaveLength(1);
  });

  it("refuses amounts outside $5 to $1,000", async () => {
    const seller = await seedSeller("amount");
    await expect(issue(seller, 100)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(issue(seller, 200_000)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

describe("partial redemption and the reserve / settle / release lifecycle", () => {
  it("spends a card across two checkouts, leaving the rest", async () => {
    const seller = await seedSeller("partial");
    const buyer = await seedBuyer("partial");
    const { card } = await issue(seller, 5_000, buyer);

    const csOne = await checkoutRow(buyer, seller);
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: csOne, amountCents: 2_000 }));
    expect(await balanceOf(card.id)).toBe(3_000); // held while the payment is in flight

    const orderOne = crypto.randomUUID();
    await db.transaction((tx) => settleForCheckout(tx, csOne, orderOne));
    expect(await balanceOf(card.id)).toBe(3_000);

    const csTwo = await checkoutRow(buyer, seller);
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: csTwo, amountCents: 3_000 }));
    expect(await balanceOf(card.id)).toBe(0);

    const types = (await ledgerOf(card.id)).map((r) => [r.type, r.amountCents, r.balanceAfterCents]);
    expect(types).toEqual([["issue", 5_000, 5_000], ["redeem", -2_000, 3_000], ["settle", 0, 3_000], ["redeem", -3_000, 0]]);
  });

  it("never lets a reservation exceed the balance", async () => {
    const seller = await seedSeller("overspend");
    const { card } = await issue(seller, 1_000);
    const cs = await checkoutRow("b", seller);
    await expect(db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 1_001 })))
      .rejects.toMatchObject({ code: "GIFT_CARD_INSUFFICIENT" });
    expect(await balanceOf(card.id)).toBe(1_000);
  });

  it("is idempotent per checkout: a retry does not take the amount twice", async () => {
    const seller = await seedSeller("idem");
    const { card } = await issue(seller, 4_000);
    const cs = await checkoutRow("b", seller);
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 1_500 }));
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 1_500 }));
    expect(await balanceOf(card.id)).toBe(2_500);
  });

  it("release gives the held amount back once, and never after settling", async () => {
    const seller = await seedSeller("release");
    const { card } = await issue(seller, 3_000);
    const cs = await checkoutRow("b", seller);
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 3_000 }));
    expect(await db.transaction((tx) => releaseForCheckout(tx, cs))).toBe(1);
    expect(await db.transaction((tx) => releaseForCheckout(tx, cs))).toBe(0);
    expect(await balanceOf(card.id)).toBe(3_000);

    const cs2 = await checkoutRow("b", seller);
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs2, amountCents: 1_000 }));
    await db.transaction((tx) => settleForCheckout(tx, cs2, crypto.randomUUID()));
    expect(await db.transaction((tx) => releaseForCheckout(tx, cs2))).toBe(0);
    expect(await balanceOf(card.id)).toBe(2_000);
  });

  it("a payment landing after the hold was released re-takes the amount when the card can still cover it", async () => {
    const seller = await seedSeller("late");
    const { card } = await issue(seller, 2_000);
    const cs = await checkoutRow("b", seller);
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 2_000 }));
    await db.transaction((tx) => releaseForCheckout(tx, cs));
    const settled = await db.transaction((tx) => settleForCheckout(tx, cs, crypto.randomUUID()));
    expect(settled).toEqual([expect.objectContaining({ amountCents: 2_000, lateDebit: true })]);
    expect(await balanceOf(card.id)).toBe(0);
  });

  it("refund gives the money back once per order", async () => {
    const seller = await seedSeller("refund");
    const { card } = await issue(seller, 2_000);
    const cs = await checkoutRow("b", seller);
    const orderId = crypto.randomUUID();
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 1_200 }));
    await db.transaction((tx) => settleForCheckout(tx, cs, orderId));
    expect(await db.transaction((tx) => refundForOrder(tx, orderId))).toEqual([{ cardId: card.id, amountCents: 1_200 }]);
    expect(await db.transaction((tx) => refundForOrder(tx, orderId))).toEqual([]);
    expect(await balanceOf(card.id)).toBe(2_000);
  });
});

describe("concurrency", () => {
  it("lets exactly as many parallel reservations through as the balance covers", async () => {
    const seller = await seedSeller("race");
    const { card } = await issue(seller, 3_000);
    const checkouts = await Promise.all(Array.from({ length: 8 }, () => checkoutRow("racer", seller)));
    const results = await Promise.allSettled(checkouts.map((cs) =>
      db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 1_000 }))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(5);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(GiftCardError);
    expect(await balanceOf(card.id)).toBe(0);
    const spent = (await ledgerOf(card.id)).filter((r) => r.type === "redeem").reduce((s, r) => s + r.amountCents, 0);
    expect(spent).toBe(-3_000);
  });

  it("parallel duplicate retries of the same checkout take the amount only once", async () => {
    const seller = await seedSeller("dup");
    const { card } = await issue(seller, 5_000);
    const cs = await checkoutRow("b", seller);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
      db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 2_000 }))));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await balanceOf(card.id)).toBe(3_000);
    expect((await ledgerOf(card.id)).filter((r) => r.type === "redeem")).toHaveLength(1);
  });

  it("a settle racing a release ends in exactly one outcome", async () => {
    const seller = await seedSeller("settle-race");
    const { card } = await issue(seller, 2_000);
    const cs = await checkoutRow("b", seller);
    await db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 2_000 }));
    await Promise.all([
      db.transaction((tx) => settleForCheckout(tx, cs, crypto.randomUUID())),
      db.transaction((tx) => releaseForCheckout(tx, cs)),
    ]);
    const types = (await ledgerOf(card.id)).map((r) => r.type);
    expect(types.filter((t) => t === "settle")).toHaveLength(1);
    // Whatever order they ran in, the balance must agree with the ledger.
    const net = (await ledgerOf(card.id)).reduce((s, r) => s + r.amountCents, 0);
    expect(await balanceOf(card.id)).toBe(net);
  });
});

describe("eligibility", () => {
  it("only reserves for the card's own store", async () => {
    const seller = await seedSeller("own");
    const other = await seedSeller("other");
    const { card } = await issue(seller, 2_000);
    const cs = await checkoutRow("b", other);
    await expect(db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 500, sellerId: other })))
      .rejects.toMatchObject({ code: "GIFT_CARD_INSUFFICIENT" });
    expect(await balanceOf(card.id)).toBe(2_000);
  });

  it("does not reserve on a void or expired card", async () => {
    const seller = await seedSeller("void");
    const { card } = await issue(seller, 2_000);
    await db.transaction((tx) => voidCard(tx, card.id, seller, seller));
    expect(await balanceOf(card.id)).toBe(0);
    const cs = await checkoutRow("b", seller);
    await expect(db.transaction((tx) => reserveForCheckout(tx, { cardId: card.id, checkoutSessionId: cs, amountCents: 500 }))).rejects.toBeInstanceOf(GiftCardError);

    const { card: old } = await issue(seller, 2_000);
    await db.update(giftCards).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(giftCards.id, old.id));
    const cs2 = await checkoutRow("b", seller);
    await expect(db.transaction((tx) => reserveForCheckout(tx, { cardId: old.id, checkoutSessionId: cs2, amountCents: 500 }))).rejects.toBeInstanceOf(GiftCardError);
  });

  it("voiding records the removed balance and a second void is a no-op", async () => {
    const seller = await seedSeller("void2");
    const { card } = await issue(seller, 2_000);
    await db.transaction((tx) => voidCard(tx, card.id, seller, seller));
    await db.transaction((tx) => voidCard(tx, card.id, seller, seller));
    expect((await ledgerOf(card.id)).map((r) => [r.type, r.amountCents])).toEqual([["issue", 2_000], ["void", -2_000]]);
    await expect(db.transaction((tx) => voidCard(tx, card.id, "someone-else", "x"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a card claimed by one buyer can't be claimed by another", async () => {
    const seller = await seedSeller("claim");
    const one = await seedBuyer("claim-1");
    const two = await seedBuyer("claim-2");
    const { card } = await issue(seller, 2_000);
    await db.transaction((tx) => claimCard(tx, card.id, one));
    await db.transaction((tx) => claimCard(tx, card.id, one)); // same buyer again is fine
    await expect(db.transaction((tx) => claimCard(tx, card.id, two))).rejects.toMatchObject({ code: "GIFT_CARD_ALREADY_CLAIMED" });
  });

  it("the ledger is append-only", async () => {
    const seller = await seedSeller("append");
    const { card } = await issue(seller, 2_000);
    await expect(db.update(giftCardTransactions).set({ amountCents: 999_999 }).where(eq(giftCardTransactions.giftCardId, card.id))).rejects.toThrow();
  });
});

describe("buying a gift card", () => {
  async function sellingStore(tag: string) {
    const seller = await seedSeller(tag);
    await saveGiftCardSettings(seller, { enabled: true, denominations: [2_500, 5_000] });
    return seller;
  }

  it("charges Brandthread's balance, shows the code once, emails the recipient, and moves nothing to the seller", async () => {
    const seller = await sellingStore("buy");
    const buyer = await seedBuyer("buy");
    const res = await call(app.base, "POST", "/api/gift-cards/purchase", buyer, {
      sellerId: seller, amountCents: 5_000, recipientEmail: "friend@test.local", recipientName: "Sam", message: "Happy birthday", clientIdempotencyKey: uid("buy"),
    });
    expect(res.status).toBe(200);
    const intent = fake.state.paymentIntents.get(res.body.paymentIntentId);
    expect(intent.amount).toBe(5_000);
    expect(intent.metadata.kind).toBe("gift_card_purchase");
    expect(intent.transfer_data).toBeUndefined(); // no destination: the money stays on Brandthread's balance

    // Not live until paid.
    const [pending] = await db.select().from(giftCards).where(eq(giftCards.id, res.body.giftCardId));
    expect(pending.status).toBe("pending_payment");
    expect(pending.codeHash).toBeNull();
    expect((await call(app.base, "POST", `/api/gift-cards/purchase/${pending.id}/confirm`, buyer, {})).body.status).toBe("unpaid");

    intent.status = "succeeded";
    const confirmed = await call(app.base, "POST", `/api/gift-cards/purchase/${pending.id}/confirm`, buyer, {});
    expect(confirmed.body.status).toBe("paid");
    expect(confirmed.body.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    const code = confirmed.body.code as string;

    // The webhook arriving afterwards (or before) neither re-issues nor re-sends.
    await handleGiftCardPaymentSucceeded(intent);
    const again = await call(app.base, "POST", `/api/gift-cards/purchase/${pending.id}/confirm`, buyer, {});
    expect(again.body.code).toBeNull();

    const [live] = await db.select().from(giftCards).where(eq(giftCards.id, pending.id));
    expect(live.status).toBe("active");
    expect(live.codeHash).toBe(hashGiftCardCode(code));
    expect(JSON.stringify(live)).not.toContain(code);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("friend@test.local");
    expect(sentEmails[0].html).toContain(code);
    expect(sentEmails[0].html).toContain("Happy birthday");

    expect(fake.state.transfers).toHaveLength(0);
    const [entry] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, `gift-card-purchase/${pending.id}`));
    expect(entry.kind).toBe("gift_card_purchased");
  });

  it("refuses stores that don't sell gift cards, and amounts they don't offer", async () => {
    const seller = await seedSeller("off");
    const buyer = await seedBuyer("off");
    const off = await call(app.base, "POST", "/api/gift-cards/purchase", buyer, {
      sellerId: seller, amountCents: 5_000, recipientEmail: "a@test.local", clientIdempotencyKey: uid("buy"),
    });
    expect(off.status).toBe(400);
    expect(off.body.code).toBe("GIFT_CARDS_DISABLED");
    const on = await sellingStore("amounts");
    const odd = await call(app.base, "POST", "/api/gift-cards/purchase", buyer, {
      sellerId: on, amountCents: 3_333, recipientEmail: "a@test.local", clientIdempotencyKey: uid("buy"),
    });
    expect(odd.body.code).toBe("INVALID_AMOUNT");
    expect(fake.state.paymentIntents.size).toBe(0);
  });

  it("a retried purchase request returns the same intent and card", async () => {
    const seller = await sellingStore("retry");
    const buyer = await seedBuyer("retry");
    const payload = { sellerId: seller, amountCents: 2_500, recipientEmail: "a@test.local", clientIdempotencyKey: uid("buy") };
    const first = await call(app.base, "POST", "/api/gift-cards/purchase", buyer, payload);
    const second = await call(app.base, "POST", "/api/gift-cards/purchase", buyer, payload);
    expect(second.body.giftCardId).toBe(first.body.giftCardId);
    expect(second.body.paymentIntentId).toBe(first.body.paymentIntentId);
  });

  it("the store can turn gift cards on and off and set amounts; wallet lists owned cards with balances", async () => {
    const seller = await seedSeller("settings");
    const pub = await call(app.base, "GET", `/api/gift-cards/store/${seller}`, "anon");
    expect(pub.body).toMatchObject({ enabled: false, denominations: [] });
    const saved = await call(app.base, "PUT", "/api/gift-cards/seller/settings", seller, { enabled: true, denominations: [10_000, 2_500, 2_500] });
    expect(saved.body.denominations).toEqual([2_500, 10_000]);
    expect((await call(app.base, "GET", `/api/gift-cards/store/${seller}`, "anon")).body.denominations).toEqual([2_500, 10_000]);
    const bad = await call(app.base, "PUT", "/api/gift-cards/seller/settings", seller, { denominations: [100] });
    expect(bad.status).toBe(400);

    const buyer = await seedBuyer("wallet");
    const issued = await call(app.base, "POST", "/api/gift-cards/seller/issue", seller, { amountCents: 4_000, recipientEmail: "w@test.local" });
    expect(issued.status).toBe(201);
    const claimed = await call(app.base, "POST", "/api/gift-cards/claim", buyer, { code: issued.body.code });
    expect(claimed.status).toBe(200);
    const mine = await call(app.base, "GET", "/api/gift-cards/mine", buyer);
    expect(mine.body.totalCents).toBe(4_000);
    expect(mine.body.cards[0]).toMatchObject({ balanceCents: 4_000, status: "active", role: "owner", last4: issued.body.code.replace(/-/g, "").slice(-4) });
    expect(JSON.stringify(mine.body)).not.toContain(issued.body.code);

    const sellerList = await call(app.base, "GET", "/api/gift-cards/seller/cards", seller);
    expect(sellerList.body.outstandingCents).toBe(4_000);
    const voided = await call(app.base, "POST", `/api/gift-cards/seller/cards/${issued.body.card.id}/void`, seller, {});
    expect(voided.body.card.status).toBe("void");
    expect((await call(app.base, "GET", "/api/gift-cards/mine", buyer)).body.totalCents).toBe(0);
  });

  it("rate limits code lookups to stop guessing", async () => {
    const buyer = await seedBuyer("brute");
    let limited = 0;
    for (let i = 0; i < 20; i++) {
      const res = await call(app.base, "POST", "/api/gift-cards/lookup", buyer, { code: "ABCD-EFGH-JKLM-NPQR" });
      if (res.status === 429) limited++;
      else expect(res.status).toBe(404);
    }
    expect(limited).toBeGreaterThan(0);
    expect(limited).toBeLessThanOrEqual(5);
  });
});

describe("at checkout", () => {
  /** Two stores; the buyer holds a card for store A. */
  async function seedCart(tag: string, cardCents: number) {
    const sellerA = await seedSeller(`${tag}-a`);
    const sellerB = await seedSeller(`${tag}-b`);
    const buyer = await seedBuyer(tag);
    const productA = await seedProduct(sellerA, { priceCents: 5_000, stock: 5 });
    const productB = await seedProduct(sellerB, { priceCents: 2_500, stock: 5 });
    const { card } = await issue(sellerA, cardCents, buyer);
    const groups = (giftCard?: { cardId?: string; code?: string }, onB = false) => [
      { items: [{ variantId: productA.variantId, productId: productA.productId, quantity: 1 }], ...(giftCard && !onB ? { giftCard } : {}) },
      { items: [{ variantId: productB.variantId, productId: productB.productId, quantity: 1 }], ...(giftCard && onB ? { giftCard } : {}) },
    ];
    return { sellerA, sellerB, buyer, card, groups };
  }
  const address = { recipientName: "Jordan Reyes", street: "148 Mercer Street", city: "New York", state: "NY", postalCode: "10012", country: "US" };
  const pay = (buyer: string, groups: unknown[]) => call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, {
    groups, contactEmail: "b@test.local", contactPhone: "+1 503 555 0100", shippingAddress: address, clientIdempotencyKey: uid("pay"),
  });
  function paid(intentId: string) {
    const intent = fake.state.paymentIntents.get(intentId);
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.latest_charge = `ch_${intentId}`;
    return intent;
  }
  async function ordersOf(intentId: string) {
    const rows = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, intentId));
    const made = await db.select().from(orders).where(sql`${orders.stripeCheckoutSessionId} IN (${sql.join(rows.map((r) => sql`${r.stripeSessionId}`), sql`, `)})`);
    return { rows, made };
  }

  it("covers part of its own store's group, charges the card only the rest, and pays the seller in full", async () => {
    const cart = await seedCart("co", 3_000);
    const quote = await pay(cart.buyer, cart.groups({ cardId: cart.card.id }));
    expect(quote.status).toBe(200);
    const [a, b] = quote.body.groups;
    expect(a.giftCardCents).toBe(3_000);
    expect(b.giftCardCents).toBe(0); // other store untouched
    expect(a.totalCents + 3_000).toBe(a.subtotalCents + a.shippingCents - a.discountCents + a.taxCents);
    expect(quote.body.amountCents).toBe(a.totalCents + b.totalCents);
    expect(await balanceOf(cart.card.id)).toBe(0); // reserved while the payment is in flight

    const intent = paid(quote.body.paymentIntentId);
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date()); // redelivery

    const { made } = await ordersOf(intent.id);
    expect(made).toHaveLength(2);
    const orderA = made.find((o) => o.ownerId === cart.sellerA)!;
    expect(orderA.grossChargedCents).toBe(a.totalCents);

    // The seller's gift card part is paid by ONE supplemental transfer, not from the charge.
    const giftTransfers = fake.state.transfers.filter((t) => t.metadata?.kind === "gift_card_seller_payout");
    expect(giftTransfers).toHaveLength(1);
    expect(giftTransfers[0]).toMatchObject({ amount: 3_000, transfer_group: orderA.id, idempotencyKey: `gift-card-payout/${orderA.id}` });
    expect(giftTransfers[0].source_transaction).toBeUndefined();
    expect(await orderLedger(orderA.id)).toMatchObject({ gift_card_liability: -3_000 });

    // Settled once, even after the redelivery.
    expect((await ledgerOf(cart.card.id)).filter((r) => r.type === "settle")).toHaveLength(1);
    expect(await balanceOf(cart.card.id)).toBe(0);
  });

  it("refuses a card on another store's group and someone else's wallet card", async () => {
    const cart = await seedCart("wrong", 3_000);
    const wrongStore = await pay(cart.buyer, cart.groups({ cardId: cart.card.id }, true));
    expect(wrongStore.status).toBe(400);
    expect(wrongStore.body.code).toBe("GIFT_CARD_WRONG_STORE");
    const stranger = await seedBuyer("wrong-2");
    const stolen = await pay(stranger, cart.groups({ cardId: cart.card.id }));
    expect(stolen.status).toBe(404);
    expect(await balanceOf(cart.card.id)).toBe(3_000);
  });

  it("two carts racing for one card can't both use it", async () => {
    const cart = await seedCart("rc", 4_000);
    const [one, two] = await Promise.all([
      pay(cart.buyer, cart.groups({ cardId: cart.card.id })),
      pay(cart.buyer, cart.groups({ cardId: cart.card.id })),
    ]);
    const used = [one, two].filter((r) => r.status === 200 && r.body.groups[0].giftCardCents > 0);
    expect(used).toHaveLength(1);
    expect(await balanceOf(cart.card.id)).toBe(0);
    const reservations = (await ledgerOf(cart.card.id)).filter((r) => r.type === "redeem");
    expect(reservations).toHaveLength(1);
  });

  it("gives the card back when the checkout is cancelled, fails, or expires", async () => {
    const cart = await seedCart("rel", 2_000);
    const first = await pay(cart.buyer, cart.groups({ cardId: cart.card.id }));
    expect(await balanceOf(cart.card.id)).toBe(0);
    await call(app.base, "POST", `/api/buyer/checkout/payment-intent/${first.body.paymentIntentId}/cancel`, cart.buyer, {});
    expect(await balanceOf(cart.card.id)).toBe(2_000);

    const second = await pay(cart.buyer, cart.groups({ cardId: cart.card.id }));
    expect(await balanceOf(cart.card.id)).toBe(0);
    await handleCartPaymentEnded(fake.state.paymentIntents.get(second.body.paymentIntentId), true);
    expect(await balanceOf(cart.card.id)).toBe(2_000);

    const third = await pay(cart.buyer, cart.groups({ cardId: cart.card.id }));
    expect(await balanceOf(cart.card.id)).toBe(0);
    await db.execute(sql`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE stripe_payment_intent_id = ${third.body.paymentIntentId}`);
    await expireStockReservations({ stripe: fake.stripe as any });
    expect(await balanceOf(cart.card.id)).toBe(2_000);
  });

  it("a full refund returns the gift card balance and reverses the seller's gift card payout", async () => {
    const cart = await seedCart("rf", 3_000);
    const res = await pay(cart.buyer, cart.groups({ cardId: cart.card.id }));
    const intent = paid(res.body.paymentIntentId);
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    const { made } = await ordersOf(intent.id);
    const orderA = made.find((o) => o.ownerId === cart.sellerA)!;
    expect(await balanceOf(cart.card.id)).toBe(0);

    await refundOrder({
      orderId: orderA.id, reason: "seller_cancelled", initiatedBy: cart.sellerA, idempotencyKey: `gc-cancel/${orderA.id}`,
      cancelOrder: { reason: "seller_cancelled", notes: null, restock: true }, stripe: fake.stripe as any,
    });
    expect(await balanceOf(cart.card.id)).toBe(3_000);
    expect(fake.state.reversals.some((r) => r.amount === 3_000 && r.metadata?.orderId === orderA.id)).toBe(true);
    expect((await ledgerOf(cart.card.id)).filter((r) => r.type === "refund")).toHaveLength(1);
    expect(await payoutSellerForOrder(fake.stripe as any, orderA.id)).toBe("already");
  });

  it("a card that covers the whole group still leaves the fees and Stripe's minimum on the card payment", async () => {
    const cart = await seedCart("big", 100_000);
    const res = await pay(cart.buyer, cart.groups({ cardId: cart.card.id }));
    expect(res.status).toBe(200);
    const [a] = res.body.groups;
    expect(a.totalCents).toBeGreaterThan(0);
    expect(res.body.amountCents).toBeGreaterThanOrEqual(50);
    expect(await balanceOf(cart.card.id)).toBe(100_000 - a.giftCardCents);
  });
});
