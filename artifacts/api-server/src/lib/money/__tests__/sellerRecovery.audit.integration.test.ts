/**
 * Audit regression for lib/money/sellerRecovery.ts (real Postgres, fake
 * Stripe): a release that nets the seller's chargeback debt while the
 * chargeback's transfer reversal is in flight must not leave the books
 * showing less than Stripe actually reversed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
  sendPushToUser: async () => {},
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
}));

import { db, sellerRecoveries } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { expectLedgerBalanced, pay, reloadOrder, seedBuyer, seedProduct, seedSeller } from "./moneyHarness";
import { accountBalanceCents } from "../ledger";
import { netRecoveriesFromRelease, recordLostChargeback, recoverByTransferReversal } from "../sellerRecovery";

const originalPayoutMode = process.env.PAYOUT_MODE;
function restorePayoutMode() {
  if (originalPayoutMode === undefined) delete process.env.PAYOUT_MODE;
  else process.env.PAYOUT_MODE = originalPayoutMode;
}
afterAll(async () => {
  restorePayoutMode();
  await expectLedgerBalanced();
});
beforeEach(() => { fake.reset(); restorePayoutMode(); });

describe("recoverByTransferReversal racing a release that nets the same debt", () => {
  it("books exactly what Stripe reversed", async () => {
    const seller = await seedSeller("audit-recovery-race");
    const product = await seedProduct(seller, { priceCents: 10_000 });
    // Paid out right away (not hold mode): the order's transfer went out.
    const paidOrder = await reloadOrder((await pay({
      sellerId: seller, buyerId: await seedBuyer("audit-rr-a"), chargeModel: "transfer",
      items: [{ ...product, quantity: 1 }], stripeFeeCents: 320,
    })).order.id);
    expect(paidOrder.fundsState).toBe("released");

    // Lost chargeback; the immediate reversal fails, so the debt stays open.
    fake.state.failNextReversal = "definitive";
    const dispute = {
      id: `dp_audit_${paidOrder.id.replace(/-/g, "").slice(0, 16)}`, amount: paidOrder.grossChargedCents, currency: "usd",
      payment_intent: paidOrder.stripePaymentIntentId, charge: paidOrder.stripeChargeId, status: "lost",
      balance_transactions: [{ amount: -paidOrder.grossChargedCents, fee: 1_500 }],
    };
    const [loss] = await recordLostChargeback(dispute, { stripe: fake.stripe as any });
    expect(loss.recovery).toMatchObject({ status: "open", recoveredCents: 0 });
    const owed = paidOrder.sellerNetCents + 1_500;

    // Another order of the seller's, still held, will be released meanwhile.
    process.env.PAYOUT_MODE = "hold";
    const heldOrder = (await pay({
      sellerId: seller, buyerId: await seedBuyer("audit-rr-b"), chargeModel: "transfer",
      items: [{ ...product, quantity: 1 }], stripeFeeCents: 320,
    })).order;
    restorePayoutMode();
    const netAmount = 2_000; // more than the 1,500 fee: it would eat into the reversed share

    let netting: Promise<unknown> | null = null;
    const racing = {
      transfers: {
        ...fake.stripe.transfers,
        createReversal: async (...args: any[]) => {
          netting = db.transaction((tx) => netRecoveriesFromRelease(tx, {
            sellerId: seller, orderId: heldOrder.id, availableCents: netAmount, ledgerKey: `audit-race/${heldOrder.id}`,
          }));
          await Promise.race([netting, new Promise((resolve) => setTimeout(resolve, 500))]);
          return (fake.stripe.transfers.createReversal as any)(...args);
        },
      },
    };
    const result = await recoverByTransferReversal(loss.recovery!.id, { stripe: racing as any });
    await netting;

    const reversal = fake.state.reversals.at(-1);
    expect(reversal.amount).toBe(paidOrder.sellerNetCents);
    expect(result.reversedCents).toBe(reversal.amount);
    // The seller's paid-out balance for the order dropped by exactly what Stripe took back.
    expect(await accountBalanceCents(db, { account: "seller_paid_out", partyId: seller, orderId: paidOrder.id }))
      .toBe(paidOrder.sellerNetCents - reversal.amount);
    const [recovery] = await db.select().from(sellerRecoveries).where(eq(sellerRecoveries.id, loss.recovery!.id));
    expect(recovery).toMatchObject({ status: "recovered", recoveredCents: owed });
    expect(await accountBalanceCents(db, { account: "seller_recoverable", partyId: seller })).toBe(0);
    await expectLedgerBalanced();
  });
});
