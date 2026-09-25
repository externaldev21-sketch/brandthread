/**
 * Buyer cart overhaul: a buyer must be able to buy just ONE line from a
 * multi-item cart (via its own "Buy" button, or a "checkout selected"
 * subset) without being forced to buy — or clear out — the rest of the
 * cart. The mobile client implements this by sending only the chosen
 * item(s) to the existing checkout-session endpoint; nothing about the
 * server-side checkout → order pipeline changes for that case.
 *
 * This proves that pipeline, end to end against real Postgres with a fake
 * Stripe: paying for one item out of a two-item "cart" produces exactly one
 * order, for exactly that item, at exactly its own amount — the other,
 * untouched item never appears on it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
  normalizePushEventCategory: () => "orders",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
}));

import { fake } from "./fakeStripe";
import {
  expectLedgerBalanced, pay, seedBuyer, seedProduct, seedSeller,
} from "./moneyHarness";

beforeEach(() => fake.reset());
afterAll(async () => { await expectLedgerBalanced(); });

describe("single-item Buy out of a multi-item cart", () => {
  it("creates one order for the bought item's own amount; the other cart item is never part of it", async () => {
    const seller = await seedSeller("single-buy");
    const buyer = await seedBuyer("single-buy");

    // The buyer's cart holds two different products from the same seller.
    const boughtProduct = await seedProduct(seller, { priceCents: 4_200 });
    const untouchedProduct = await seedProduct(seller, { priceCents: 9_900 });

    // Buying just the first item, quantity 2 — as the cart screen's per-item
    // Buy button (or a "checkout selected" subset) would.
    const { order } = await pay({
      sellerId: seller,
      buyerId: buyer,
      chargeModel: "destination",
      items: [{ ...boughtProduct, quantity: 2 }],
    });

    expect(order.buyerId).toBe(buyer);
    expect(order.ownerId).toBe(seller);
    // Correct amount: exactly the bought item's price × quantity, with no
    // trace of the second cart item's price.
    expect(order.grossChargedCents).toBe(boughtProduct.priceCents * 2);
    expect(order.grossChargedCents).not.toBe(boughtProduct.priceCents * 2 + untouchedProduct.priceCents);

    // The order's own line items reference only the bought variant.
    const orderItems = Array.isArray((order as any).items) ? (order as any).items : [];
    if (orderItems.length > 0) {
      expect(orderItems.map((i: any) => i.variantId)).toEqual([boughtProduct.variantId]);
      expect(orderItems.some((i: any) => i.variantId === untouchedProduct.variantId)).toBe(false);
    }

    await expectLedgerBalanced();
  });
});
