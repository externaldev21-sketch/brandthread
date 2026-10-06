/**
 * AI credit pack purchases: Stripe Checkout (web) and RevenueCat consumables
 * (iOS / Android store billing). Pack price and credit count come only from
 * CREDIT_PACKS; nothing the client or a session's metadata claims about
 * amounts is trusted.
 */
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { aiCreditPurchases, db } from "@workspace/db";
import { findPack, type CreditPack } from "./catalogue";
import { grantPurchasedCredits } from "./ledger";
import { isAllowedBrandthreadCallbackUrl } from "../brandthreadCallbackUrls";

export const AI_CREDITS_CHECKOUT_KIND = "ai_credits";

/** Store product ids Dev creates in App Store Connect / Play Console / RevenueCat. */
export const RC_CREDIT_PRODUCTS: Record<string, string> = {
  brandthread_ai_credits_500: "credits_500",
  brandthread_ai_credits_1500: "credits_1500",
  brandthread_ai_credits_5000: "credits_5000",
};

export function packForRevenueCatProduct(productId: unknown): CreditPack | null {
  if (typeof productId !== "string") return null;
  // Android product ids may carry a base-plan suffix (`id:base`).
  const id = productId.split(":")[0]!;
  const packId = RC_CREDIT_PRODUCTS[id];
  return packId ? findPack(packId) : null;
}

export function isAllowedCreditsReturnUrl(value: unknown): value is string {
  return isAllowedBrandthreadCallbackUrl(value, "ai_credits_checkout");
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY?.trim();
}

export async function createPackCheckout(
  stripe: Pick<Stripe, "checkout">,
  input: { clerkUserId: string; pack: CreditPack; returnUrl: string },
): Promise<{ sessionId: string; url: string | null }> {
  const { clerkUserId, pack, returnUrl } = input;
  const successUrl = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}checkout_session_id={CHECKOUT_SESSION_ID}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: pack.amountCents,
        product_data: { name: `Brandthread AI credits · ${pack.label}` },
      },
    }],
    success_url: successUrl,
    cancel_url: returnUrl,
    metadata: { kind: AI_CREDITS_CHECKOUT_KIND, packId: pack.id, clerkUserId },
  });
  await db.insert(aiCreditPurchases).values({
    clerkUserId, packId: pack.id, credits: pack.credits, amountCents: pack.amountCents,
    stripeCheckoutSessionId: session.id, status: "pending_payment",
  }).onConflictDoNothing();
  return { sessionId: session.id, url: session.url ?? null };
}

export type FulfilResult =
  | { ok: true; granted: boolean; credits: number }
  | { ok: false; code: "metadata_mismatch" | "amount_mismatch" | "unpaid" | "unknown_pack" };

/**
 * Validates a retrieved/webhook Checkout Session and credits it exactly once.
 * `expectedUserId` (verify endpoint) rejects sessions belonging to someone else.
 */
export async function fulfilCreditCheckoutSession(
  session: Pick<Stripe.Checkout.Session, "id" | "metadata" | "payment_status" | "amount_total" | "currency">,
  expectedUserId?: string,
): Promise<FulfilResult> {
  const meta = session.metadata ?? {};
  const userId = meta.clerkUserId;
  if (meta.kind !== AI_CREDITS_CHECKOUT_KIND || !userId || (expectedUserId && userId !== expectedUserId)) {
    return { ok: false, code: "metadata_mismatch" };
  }
  const pack = findPack(meta.packId ?? "");
  if (!pack) return { ok: false, code: "unknown_pack" };
  if (session.amount_total !== pack.amountCents || session.currency !== "usd") {
    return { ok: false, code: "amount_mismatch" };
  }
  if (session.payment_status !== "paid") return { ok: false, code: "unpaid" };

  const { granted } = await grantPurchasedCredits({
    clerkUserId: userId,
    credits: pack.credits,
    idempotencyKey: `stripe:${session.id}`,
    reference: session.id,
    meta: { packId: pack.id, source: "stripe", amountCents: pack.amountCents },
  });
  const updated = await db.update(aiCreditPurchases)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(aiCreditPurchases.stripeCheckoutSessionId, session.id), eq(aiCreditPurchases.clerkUserId, userId)))
    .returning({ id: aiCreditPurchases.id });
  if (updated.length === 0) {
    await db.insert(aiCreditPurchases).values({
      clerkUserId: userId, packId: pack.id, credits: pack.credits, amountCents: pack.amountCents,
      stripeCheckoutSessionId: session.id, status: "paid", paidAt: new Date(),
    }).onConflictDoNothing();
  }
  return { ok: true, granted, credits: pack.credits };
}

/**
 * RevenueCat NON_RENEWING_PURCHASE for a credit product. Idempotent by RevenueCat event id.
 * A completed store purchase is always credited, whatever the plan is now.
 */
export async function grantRevenueCatCreditPurchase(input: {
  eventId: string; appUserId: string; productId: unknown;
}): Promise<{ handled: boolean; granted?: boolean }> {
  const pack = packForRevenueCatProduct(input.productId);
  if (!pack) return { handled: false };
  const { granted } = await grantPurchasedCredits({
    clerkUserId: input.appUserId,
    credits: pack.credits,
    idempotencyKey: `rc:${input.eventId}`,
    reference: input.eventId,
    meta: { packId: pack.id, source: "revenuecat", productId: String(input.productId) },
  });
  return { handled: true, granted };
}

