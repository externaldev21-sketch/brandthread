import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { db, referrals, sellerReferrals, sellerSubscriptionEntitlements, users } from "@workspace/db";
import { applySellerReferralCode, runSellerReferrals, sellerReferralSummary } from "./service";
import { sellerReferralConfig } from "./config";

const sfx = crypto.randomBytes(4).toString("hex");
const id = (n: string) => `sr-${sfx}-${n}`;
const A = id("brand-a");      // referring brand, Stripe-billed
const B = id("brand-b");      // joined via A's link, Stripe-billed
const C = id("brand-c");      // enters A's code, App Store-billed
const D = id("buyer");        // a buyer can't use a brand code
const E = id("brand-e");      // still in trial
const codeA = `A${sfx.toUpperCase()}`.slice(0, 8);
const cfg = sellerReferralConfig({ SELLER_REFERRAL_ENABLED: "true" });
const off = sellerReferralConfig({});

const balanceCalls: Array<{ customer: string; amount: number; currency: string; key: string }> = [];
const fakeStripe: any = {
  invoices: { list: async ({ subscription }: any) => ({ data: subscription === `sub_${B}` ? [{ amount_paid: 7900 }] : [] }) },
  subscriptions: {
    retrieve: async (subId: string) => ({
      items: { data: [{ price: subId === `sub_${A}` ? { unit_amount: 199000, currency: "usd", recurring: { interval: "year" } } : { unit_amount: 7900, currency: "usd", recurring: { interval: "month" } } }] },
    }),
  },
  customers: {
    createBalanceTransaction: async (customer: string, body: any, opts: any) => {
      balanceCalls.push({ customer, amount: body.amount, currency: body.currency, key: opts.idempotencyKey });
      return { id: `cbtxn_${balanceCalls.length}` };
    },
  },
};

beforeAll(async () => {
  const seller = (clerkId: string, extra: Record<string, unknown> = {}) => ({
    clerkId, email: `${clerkId}@example.test`, name: clerkId, username: clerkId.replace(/-/g, "_").slice(0, 30), accountType: "seller", onboardingComplete: true, ...extra,
  });
  await db.insert(users).values([
    seller(A, { inviteCode: codeA, brandName: "Brand A", stripeCustomerId: `cus_${A}`, subscriptionId: `sub_${A}`, subscriptionStatus: "active" }),
    seller(B, { brandName: "Brand B", stripeCustomerId: `cus_${B}`, subscriptionId: `sub_${B}`, subscriptionStatus: "active" }),
    seller(C, { brandName: "Brand C" }),
    { ...seller(D), accountType: "buyer" },
    seller(E, { brandName: "Brand E", stripeCustomerId: `cus_${E}`, subscriptionId: `sub_${E}`, subscriptionStatus: "trialing" }),
  ]);
  await db.insert(referrals).values([
    { inviterId: A, inviteeId: B, inviteCode: codeA, source: "link" },
    { inviterId: A, inviteeId: E, inviteCode: codeA, source: "link" },
  ]);
  await db.insert(sellerSubscriptionEntitlements).values({ clerkUserId: C, provider: "revenuecat", status: "trial", planId: "growth" });
});

afterAll(async () => {
  const all = [A, B, C, D, E];
  await db.delete(sellerReferrals).where(or(inArray(sellerReferrals.inviterId, all), inArray(sellerReferrals.inviteeId, all)));
  await db.delete(referrals).where(inArray(referrals.inviteeId, all));
  await db.delete(sellerSubscriptionEntitlements).where(inArray(sellerSubscriptionEntitlements.clerkUserId, all));
  await db.delete(users).where(inArray(users.clerkId, all));
});

describe("seller-to-seller referrals (BT-313)", () => {
  it("does nothing while switched off", async () => {
    expect(await runSellerReferrals({ stripe: fakeStripe, cfg: off })).toEqual({ synced: 0, rewarded: 0, voided: 0 });
    expect((await applySellerReferralCode(C, codeA, off)).ok).toBe(false);
  });

  it("only lets a new brand apply another brand's code, once", async () => {
    expect(await applySellerReferralCode(D, codeA, cfg)).toMatchObject({ ok: false, code: "NOT_A_SELLER" });
    expect((await applySellerReferralCode(A, codeA, cfg)).ok).toBe(false); // own code (and already paying)
    expect(await applySellerReferralCode(C, "NOPE99", cfg)).toMatchObject({ ok: false, code: "INVALID_CODE" });
    expect(await applySellerReferralCode(C, codeA.toLowerCase(), cfg)).toEqual({ ok: true, inviterId: A });
    expect(await applySellerReferralCode(C, codeA, cfg)).toMatchObject({ ok: false, code: "ALREADY_APPLIED" });
    expect(await applySellerReferralCode(C, codeA, cfg, new Date(Date.now() + 31 * 86_400_000))).toMatchObject({ ok: false });
  });

  it("credits both brands a month once the new brand's first paid month goes through — never during the trial", async () => {
    const first = await runSellerReferrals({ stripe: fakeStripe, cfg });
    expect(first.synced).toBe(2); // B and E came in through A's link
    expect(first.rewarded).toBe(1); // only B has paid; E is trialing, C is in an App Store trial

    const [rowB] = await db.select().from(sellerReferrals).where(eq(sellerReferrals.inviteeId, B));
    expect(rowB.status).toBe("rewarded");
    // A pays yearly ($1,990/yr → $165.83/mo); B pays $79/mo.
    expect(rowB.inviterReward).toMatchObject({ method: "stripe_balance", amountCents: 16583, currency: "usd" });
    expect(rowB.inviteeReward).toMatchObject({ method: "stripe_balance", amountCents: 7900, currency: "usd" });
    expect(balanceCalls).toEqual([
      { customer: `cus_${A}`, amount: -16583, currency: "usd", key: `seller-referral:${rowB.id}:inviter` },
      { customer: `cus_${B}`, amount: -7900, currency: "usd", key: `seller-referral:${rowB.id}:invitee` },
    ]);

    const pendingE = await db.select().from(sellerReferrals).where(eq(sellerReferrals.inviteeId, E));
    expect(pendingE[0].status).toBe("pending");
  });

  it("never pays twice", async () => {
    const again = await runSellerReferrals({ stripe: fakeStripe, cfg });
    expect(again.rewarded).toBe(0);
    expect(balanceCalls).toHaveLength(2);
  });

  it("records store-billed brands for a manual offer code once their paid month starts", async () => {
    await db.update(sellerSubscriptionEntitlements).set({ status: "active" }).where(eq(sellerSubscriptionEntitlements.clerkUserId, C));
    await runSellerReferrals({ stripe: fakeStripe, cfg });
    const [rowC] = await db.select().from(sellerReferrals).where(eq(sellerReferrals.inviteeId, C));
    expect(rowC.status).toBe("rewarded");
    expect(rowC.inviteeReward).toMatchObject({ method: "app_store_manual" });
    expect(rowC.inviterReward).toMatchObject({ method: "stripe_balance" });
  });

  it("caps the referring brand", async () => {
    const capped = sellerReferralConfig({ SELLER_REFERRAL_ENABLED: "true", SELLER_REFERRAL_MAX_REWARDS_PER_SELLER: "2" });
    await db.update(users).set({ subscriptionStatus: "active" }).where(eq(users.clerkId, E));
    fakeStripe.invoices.list = async () => ({ data: [{ amount_paid: 7900 }] });
    await runSellerReferrals({ stripe: fakeStripe, cfg: capped });
    const [rowE] = await db.select().from(sellerReferrals).where(eq(sellerReferrals.inviteeId, E));
    expect(rowE.inviterReward).toMatchObject({ method: "capped" });
    expect(rowE.inviteeReward).toMatchObject({ method: "stripe_balance" });
  });

  it("shows the referring brand who joined and what they earned", async () => {
    const summary = await sellerReferralSummary(A);
    expect(summary.referred.map((r) => [r.name, r.status]).sort()).toEqual([["Brand B", "rewarded"], ["Brand C", "rewarded"], ["Brand E", "capped"]]);
    expect((await sellerReferralSummary(C)).hasReferrer).toBe(true);
  });
});
