/**
 * Audit: a draw capture that errors (timeout / 5xx) after Stripe actually
 * captured must still count as a win: the winner's checkout row and stock
 * hold stay, so the payment_intent.succeeded webhook can build the order.
 */
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stripe")>();
  const { fake } = await import("../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe };
});
vi.mock("../../routes/notifications-feed", () => ({ publishNotification: async () => undefined }));

import { and, eq } from "drizzle-orm";
import { db, checkoutSessions, productDrawEntries, productDraws, productLaunches, productVariants } from "@workspace/db";
import { fake } from "../money/__tests__/fakeStripe";
import { seedBuyer, seedProduct, seedSeller } from "../money/__tests__/moneyHarness";
import { newDrawSeed, runOneDraw } from "../productDraws";

beforeEach(() => { fake.reset(); });

describe("draw capture with an ambiguous error (audit)", () => {
  it("treats a capture Stripe completed as a win and keeps the checkout row and hold", async () => {
    const seller = await seedSeller("draw-audit");
    const product = await seedProduct(seller, { priceCents: 20_000, stock: 1 });
    const now = new Date();
    await db.insert(productLaunches).values({ productId: product.productId, launchAt: new Date(now.getTime() - 60 * 60_000), launchedAt: now });
    const { seed, seedHash } = newDrawSeed();
    await db.insert(productDraws).values({ productId: product.productId, entryClosesAt: new Date(now.getTime() - 1000), status: "open", seed, seedHash });

    const buyer = await seedBuyer("draw-audit");
    const intent: any = await fake.stripe.paymentIntents.create({
      amount: 20_000, currency: "usd", capture_method: "manual", metadata: { kind: "cart_checkout", buyerId: buyer },
    }, { idempotencyKey: `audit-${crypto.randomUUID()}` });
    fake.state.paymentIntents.get(intent.id).status = "requires_capture";
    const [entry] = await db.insert(productDrawEntries).values({
      productId: product.productId, buyerId: buyer, variantId: product.variantId, status: "entered",
      stripePaymentIntentId: intent.id, amountCents: 20_000,
      priced: {
        sellerId: seller,
        items: [{ variantId: product.variantId, productId: product.productId, productName: "Tee", variantLabel: "M", quantity: 1, priceCents: 20_000 }],
        subtotalCents: 20_000, shippingCents: 0, taxCents: 0, totalCents: 20_000,
        platformFeeCents: 1_000, platformFeeBps: 500, processingFeeEstimateCents: 0, stripeTaxCalculationId: null,
        shippingAddress: { name: "B", street: "1 St", line2: null, city: "New York", state: "NY", zip: "10012", country: "US" },
      },
    }).returning();

    // Stripe captures, but the response never arrives.
    const stripe = {
      paymentIntents: {
        ...fake.stripe.paymentIntents,
        capture: async (id: string) => {
          await fake.stripe.paymentIntents.capture(id);
          throw Object.assign(new Error("socket hang up"), { statusCode: 500, type: "StripeConnectionError" });
        },
      },
    } as any;

    const stockBefore = (await db.select({ s: productVariants.stock }).from(productVariants).where(eq(productVariants.id, product.variantId)))[0].s;
    expect(await runOneDraw(stripe, product.productId, new Date())).toEqual({ won: 1, lost: 0, failed: 0 });

    const [after] = await db.select().from(productDrawEntries).where(eq(productDrawEntries.id, entry.id));
    expect(after.status).toBe("won");
    expect(fake.state.paymentIntents.get(intent.id).status).toBe("succeeded");
    const rows = await db.select().from(checkoutSessions)
      .where(and(eq(checkoutSessions.clientIdempotencyKey, `draw_${entry.id}`), eq(checkoutSessions.stripePaymentIntentId, intent.id)));
    expect(rows).toHaveLength(1);
    const stockAfter = (await db.select({ s: productVariants.stock }).from(productVariants).where(eq(productVariants.id, product.variantId)))[0].s;
    expect(stockBefore - stockAfter).toBe(1);
  });
});
