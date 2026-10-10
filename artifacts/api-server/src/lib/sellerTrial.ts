/**
 * The seller free trial (Dev's trial decision):
 *  - one trial per person, device and card (seller_trial_claims);
 *  - where a seller manages or cancels a plan (Stripe on web; the App Store /
 *    Google Play subscription page for an in-app purchase).
 *
 * The App Store and Google Play already allow one introductory offer per
 * store account. These checks cover the Stripe rail and the gaps between the
 * rails (an account that trialed in the app can't trial again on the web).
 */
import type { Request } from "express";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { db, sellerSubscriptionEntitlements, sellerTrialClaims, users } from "@workspace/db";
import { getWebOrigin } from "./webOrigin";
import { logger } from "./logger";

/** Store pages where a subscriber manages or cancels an in-app subscription. */
export const STORE_MANAGE_URLS = {
  app_store: "https://apps.apple.com/account/subscriptions",
  play_store: "https://play.google.com/store/account/subscriptions",
} as const;

/** The app's anonymous install id (x-bt-install-id), when the client sends a well-formed one. */
export function installIdFrom(req: Pick<Request, "header">): string | null {
  const value = req.header("x-bt-install-id")?.trim();
  return value && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
}

/**
 * True when this person (and this device, when known) has never had a seller
 * trial on any rail. A trial already recorded on the account, a native trial
 * on the account, or any trial from the same install rules it out.
 */
export async function isTrialEligible(input: { clerkId: string; installId?: string | null }): Promise<boolean> {
  const [user] = await db.select({ trialStartedAt: users.subscriptionTrialStartedAt })
    .from(users).where(eq(users.clerkId, input.clerkId)).limit(1);
  if (user?.trialStartedAt) return false;

  const [claim] = await db.select({ id: sellerTrialClaims.id }).from(sellerTrialClaims)
    .where(input.installId
      ? or(eq(sellerTrialClaims.clerkId, input.clerkId), eq(sellerTrialClaims.installId, input.installId))
      : eq(sellerTrialClaims.clerkId, input.clerkId))
    .limit(1);
  if (claim) return false;

  const [nativeTrial] = await db.select({ id: sellerSubscriptionEntitlements.id }).from(sellerSubscriptionEntitlements)
    .where(and(
      eq(sellerSubscriptionEntitlements.clerkUserId, input.clerkId),
      isNotNull(sellerSubscriptionEntitlements.trialEndsAt),
    ))
    .limit(1);
  return !nativeTrial;
}

/** Records a started trial. Idempotent per (provider, subscriptionRef). */
export async function recordTrialClaim(input: {
  clerkId: string;
  provider: "stripe" | "revenuecat";
  subscriptionRef: string;
  installId?: string | null;
  cardFingerprint?: string | null;
}): Promise<void> {
  await db.insert(sellerTrialClaims).values({
    clerkId: input.clerkId,
    provider: input.provider,
    subscriptionRef: input.subscriptionRef,
    installId: input.installId ?? null,
    cardFingerprint: input.cardFingerprint ?? null,
  }).onConflictDoUpdate({
    target: [sellerTrialClaims.provider, sellerTrialClaims.subscriptionRef],
    // Fill in what a later event knows (e.g. the card) without losing what an earlier one recorded.
    set: {
      installId: sql`COALESCE(${sellerTrialClaims.installId}, excluded.install_id)`,
      cardFingerprint: sql`COALESCE(${sellerTrialClaims.cardFingerprint}, excluded.card_fingerprint)`,
    },
  });
}

export async function hasTrialClaim(provider: "stripe" | "revenuecat", subscriptionRef: string): Promise<boolean> {
  const [row] = await db.select({ id: sellerTrialClaims.id }).from(sellerTrialClaims)
    .where(and(eq(sellerTrialClaims.provider, provider), eq(sellerTrialClaims.subscriptionRef, subscriptionRef)))
    .limit(1);
  return !!row;
}

/** True when a different account already started a trial with this card. */
export async function cardTrialedByAnotherAccount(cardFingerprint: string, clerkId: string): Promise<boolean> {
  const [row] = await db.select({ id: sellerTrialClaims.id }).from(sellerTrialClaims)
    .where(and(eq(sellerTrialClaims.cardFingerprint, cardFingerprint), ne(sellerTrialClaims.clerkId, clerkId)))
    .limit(1);
  return !!row;
}

type StripeLike = {
  paymentMethods: { retrieve: (id: string) => Promise<any> };
  subscriptions: { cancel: (id: string, params?: Record<string, unknown>) => Promise<any> };
};

async function cardFingerprintOf(stripe: StripeLike, paymentMethod: unknown): Promise<string | null> {
  if (paymentMethod && typeof paymentMethod === "object") {
    const fp = (paymentMethod as any).card?.fingerprint;
    return typeof fp === "string" ? fp : null;
  }
  if (typeof paymentMethod !== "string") return null;
  const pm = await stripe.paymentMethods.retrieve(paymentMethod);
  return typeof pm?.card?.fingerprint === "string" ? pm.card.fingerprint : null;
}

export type StripeTrialCheck = "recorded" | "already_recorded" | "card_reused" | "not_trialing";

/**
 * Called for every Stripe subscription event. The first time a subscription
 * is seen trialing, it records the claim. If the card was already used for
 * another account's trial, the new subscription is cancelled right away, so
 * nothing is ever charged, and the seller is told to pick a plan without a
 * trial (this account now has a claim, so checkout won't offer one).
 */
export async function checkStripeTrial(stripe: StripeLike, sub: any, clerkId: string): Promise<StripeTrialCheck> {
  if (sub?.status !== "trialing" || typeof sub.id !== "string") return "not_trialing";
  if (await hasTrialClaim("stripe", sub.id)) return "already_recorded";

  const fingerprint = await cardFingerprintOf(stripe, sub.default_payment_method).catch((err) => {
    logger.warn({ err, subscriptionId: sub.id }, "Could not read the trial card fingerprint");
    return null;
  });
  const installId = typeof sub.metadata?.installId === "string" ? sub.metadata.installId : null;
  const reused = fingerprint ? await cardTrialedByAnotherAccount(fingerprint, clerkId) : false;
  // A refused trial still counts for this person and device, but the card stays
  // tied only to the account that actually trialed with it.
  await recordTrialClaim({ clerkId, provider: "stripe", subscriptionRef: sub.id, installId, cardFingerprint: reused ? null : fingerprint });
  if (!reused) return "recorded";

  await stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
  logger.info({ subscriptionId: sub.id, clerkId }, "Cancelled a trial on a card another account already trialed with");
  try {
    const { publishNotification } = await import("../routes/notifications-feed");
    await publishNotification({
      userId: clerkId,
      category: "subscription",
      pushCategory: "subscription",
      type: "subscription_trial_card_reused",
      title: "Your free trial didn't start",
      body: "This card was already used for a Brandthread free trial, so nothing was charged. Pick a plan to subscribe without a trial.",
      targetType: "subscription",
      cta: "Pick a plan",
    });
  } catch (err) {
    logger.warn({ err, clerkId }, "Trial card-reuse notice failed");
  }
  return "card_reused";
}

/** Records a native (App Store / Play) trial the first time RevenueCat reports it. */
export async function recordNativeTrialClaim(
  clerkId: string,
  record: { status: string; productIdentifier: string | null; trialEndsAt: Date | null; expiresAt: Date | null },
  installId?: string | null,
): Promise<void> {
  if (record.status !== "trial") return;
  const end = record.trialEndsAt ?? record.expiresAt;
  if (!record.productIdentifier || !end) return;
  await recordTrialClaim({
    clerkId,
    provider: "revenuecat",
    subscriptionRef: `${record.productIdentifier}:${end.toISOString()}`,
    installId,
  });
}

export type NativeSubscriptionDetails = {
  store: string | null;
  /** false once the subscriber turned off auto-renew (cancelled in the store). null when unknown. */
  willRenew: boolean | null;
  managementUrl: string | null;
};

/** Store, auto-renew and management link from the RevenueCat record saved by reconcileRevenueCatEntitlement. */
export function nativeSubscriptionDetails(native: { providerData?: unknown; productIdentifier?: string | null } | null | undefined): NativeSubscriptionDetails {
  const items = (native?.providerData as { items?: unknown[] } | null)?.items;
  const list = Array.isArray(items) ? items.filter((i): i is Record<string, unknown> => !!i && typeof i === "object") : [];
  const live = list.find((i) => !["expired", "canceled", "cancelled"].includes(String(i.status ?? "").toLowerCase())) ?? list[0];
  if (!live) return { store: null, willRenew: null, managementUrl: null };
  const renewal = String(live.auto_renewal_status ?? "").toLowerCase();
  return {
    store: typeof live.store === "string" ? live.store : null,
    willRenew: renewal ? renewal !== "will_not_renew" : null,
    managementUrl: typeof live.management_url === "string" && /^https:\/\//.test(live.management_url) ? live.management_url : null,
  };
}

/** Where "Manage" / "Cancel plan" goes for a seller on this rail. */
export function manageUrlFor(provider: string, native?: NativeSubscriptionDetails | null): string {
  if (provider === "revenuecat") {
    if (native?.managementUrl) return native.managementUrl;
    return native?.store === "play_store" ? STORE_MANAGE_URLS.play_store : STORE_MANAGE_URLS.app_store;
  }
  return `${getWebOrigin()}/subscription`;
}
