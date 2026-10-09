/**
 * Native in-app purchases for Boost, Create-ad and Featured on Discover
 * (App Store Guideline 3.1.1).
 *
 * Paid promotion bought inside the iOS / Android app is a digital good, so the
 * native apps sell it as RevenueCat CONSUMABLE products, one product per fixed
 * budget tier. Stripe Checkout stays as-is for web (see
 * docs/review-readiness/iap-rails.md).
 *
 * The grant is driven by the server, never by a device claim:
 *   - RevenueCat webhook (NON_RENEWING_PURCHASE) -> grantPromotionPurchase
 *   - POST /api/iap-promotions/.../verify (client asks; the server re-reads
 *     the purchase from RevenueCat before granting)
 * Both funnel through grantPromotionPurchase, which is idempotent on the store
 * transaction id.
 *
 * This file is storage-agnostic (PromoStore) so the rules are unit-testable
 * without a database; iapPromotionsStore.ts holds the Drizzle implementation.
 */

import { FEATURED_DURATIONS, FEATURED_PRICE_LIST } from "./promotions/featured";

export type PromoKind = "boost" | "ad_campaign" | "featured_slot";
type BudgetKind = Exclude<PromoKind, "featured_slot">;

/** Whole-dollar budgets sold natively. Every tier is a valid existing budget step. */
export const IAP_PROMO_TIER_DOLLARS = [5, 10, 25, 50, 100, 250, 500] as const;

const PRODUCT_PREFIX: Record<PromoKind, string> = {
  boost: "brandthread_boost_",
  ad_campaign: "brandthread_ad_",
  featured_slot: "brandthread_featured_",
};

export function promoProductId(kind: BudgetKind, dollars: number): string {
  return `${PRODUCT_PREFIX[kind]}${dollars}`;
}

/** Featured slots are sold per length ("brandthread_featured_7d"); the price is the server price list. */
export function featuredProductId(durationDays: number): string {
  return `${PRODUCT_PREFIX.featured_slot}${durationDays}d`;
}

/** Every promotion product id Dev must create in App Store Connect / Play / RevenueCat. */
export function allPromoProductIds(): string[] {
  return [
    ...(["boost", "ad_campaign"] as const).flatMap((kind) =>
      IAP_PROMO_TIER_DOLLARS.map((d) => promoProductId(kind, d))),
    ...FEATURED_DURATIONS.map(featuredProductId),
  ];
}

/** Returns the kind + amount a product id sells, or null when it is not a promotion product. */
export function parsePromoProductId(raw: unknown): { kind: PromoKind; amountCents: number } | null {
  if (typeof raw !== "string") return null;
  // Play Billing may report "product:base-plan"; consumables have none, tolerate it anyway.
  const id = raw.split(":")[0];
  if (id.startsWith(PRODUCT_PREFIX.featured_slot)) {
    const m = /^(\d+)d$/.exec(id.slice(PRODUCT_PREFIX.featured_slot.length));
    const days = m ? Number(m[1]) : NaN;
    return FEATURED_DURATIONS.includes(days)
      ? { kind: "featured_slot", amountCents: FEATURED_PRICE_LIST[days] }
      : null;
  }
  for (const kind of ["boost", "ad_campaign"] as const) {
    const prefix = PRODUCT_PREFIX[kind];
    if (!id.startsWith(prefix)) continue;
    const dollars = Number(id.slice(prefix.length));
    if ((IAP_PROMO_TIER_DOLLARS as readonly number[]).includes(dollars)) {
      return { kind, amountCents: dollars * 100 };
    }
  }
  return null;
}

/**
 * Feature flag. ON by default: the native apps sell promotions only through the
 * store (3.1.1). A literal "false" pauses server-side grants; the RevenueCat
 * webhook then answers 503 so each purchase is retried once it is back on.
 */
export function iapPromotionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.IAP_PROMOTIONS_ENABLED !== "false";
}

export type PurchaseRow = {
  transactionId: string;
  appUserId: string;
  productId: string;
  kind: PromoKind;
  amountCents: number;
  targetId: string | null;
  grantedAt: Date | null;
};

export type PromoTarget = { id: string; budgetCents: number };
export type ActivateResult = "activated" | "already_active" | "ineligible";

export interface PromoStore {
  /** Insert the purchase if new. Returns the stored row and whether this call created it. */
  claimPurchase(row: Omit<PurchaseRow, "targetId" | "grantedAt"> & { source: string }): Promise<{ created: boolean; purchase: PurchaseRow }>;
  /**
   * The unpaid boost / campaign this purchase should fund. With explicitId the
   * caller is verifying a specific target (owned by ownerId); without it the
   * webhook picks the newest unpaid target owned by the purchaser.
   */
  findTarget(kind: PromoKind, ownerId: string, explicitId?: string): Promise<PromoTarget | null>;
  activate(kind: PromoKind, targetId: string, paidAt: Date): Promise<ActivateResult>;
  markGranted(transactionId: string, targetId: string, at: Date): Promise<void>;
  /**
   * Atomically reserves one unspent purchase (credit) of this kind and amount
   * for targetId. Returns its transaction id, or null when there is none.
   */
  claimCredit(appUserId: string, kind: PromoKind, amountCents: number, targetId: string, at: Date): Promise<string | null>;
  /** Returns a reserved or granted purchase to the unspent pool (target never ran). */
  releaseCredit(transactionId: string): Promise<void>;
}

export type GrantResult =
  | { status: "granted" | "already_granted"; kind: PromoKind; targetId: string }
  | { status: "ignored" }
  | { status: "unmatched"; kind: PromoKind }
  | { status: "amount_mismatch"; kind: PromoKind }
  | { status: "ineligible"; kind: PromoKind; targetId: string }
  | { status: "conflict" };

export async function grantPromotionPurchase(
  store: PromoStore,
  input: {
    appUserId: string;
    transactionId: string;
    productId: string;
    source: "webhook" | "client_verify";
    /** Store owner that owns the target (defaults to appUserId; differs for team members). */
    ownerId?: string;
    explicitTargetId?: string;
    /** When set, the product must sell this kind (verify endpoints). */
    expectedKind?: PromoKind;
    now?: Date;
  },
): Promise<GrantResult> {
  const parsed = parsePromoProductId(input.productId);
  if (!parsed || !input.transactionId) return { status: "ignored" };
  if (input.expectedKind && parsed.kind !== input.expectedKind) return { status: "ignored" };
  const now = input.now ?? new Date();

  const { purchase } = await store.claimPurchase({
    transactionId: input.transactionId,
    appUserId: input.appUserId,
    productId: input.productId,
    kind: parsed.kind,
    amountCents: parsed.amountCents,
    source: input.source,
  });
  // A purchase belongs to whoever RevenueCat says bought it, never to a second claimant.
  if (purchase.appUserId !== input.appUserId) return { status: "conflict" };
  if (purchase.grantedAt && purchase.targetId) {
    return { status: "already_granted", kind: parsed.kind, targetId: purchase.targetId };
  }

  const target = await store.findTarget(parsed.kind, input.ownerId ?? input.appUserId, input.explicitTargetId);
  if (!target) return { status: "unmatched", kind: parsed.kind };
  if (target.budgetCents !== parsed.amountCents) return { status: "amount_mismatch", kind: parsed.kind };

  const result = await store.activate(parsed.kind, target.id, now);
  if (result === "ineligible") return { status: "ineligible", kind: parsed.kind, targetId: target.id };
  await store.markGranted(input.transactionId, target.id, now);
  return { status: "granted", kind: parsed.kind, targetId: target.id };
}

// ─── Store credit (BT-022) ────────────────────────────────────────────────────
//
// A store purchase that could not be applied (nothing pending, budget changed,
// post no longer eligible, promotion rejected or withdrawn before it ran) is
// never dropped: its row stays ungranted, and the seller's next promotion of
// the same kind and amount uses it instead of charging again. Apple and Google
// own refunds for store purchases, so this credit is what keeps every charge
// delivered.

export type ApplyCreditResult =
  | { status: "granted" | "already_active"; kind: PromoKind; targetId: string; transactionId: string }
  | { status: "no_credit" | "unmatched" | "ineligible"; kind: PromoKind };

export async function applyPromotionCredit(
  store: PromoStore,
  input: { appUserId: string; ownerId?: string; kind: PromoKind; targetId: string; now?: Date },
): Promise<ApplyCreditResult> {
  const now = input.now ?? new Date();
  const target = await store.findTarget(input.kind, input.ownerId ?? input.appUserId, input.targetId);
  if (!target) return { status: "unmatched", kind: input.kind };
  const transactionId = await store.claimCredit(input.appUserId, input.kind, target.budgetCents, target.id, now);
  if (!transactionId) return { status: "no_credit", kind: input.kind };
  const result = await store.activate(input.kind, target.id, now);
  if (result === "ineligible") {
    await store.releaseCredit(transactionId);
    return { status: "ineligible", kind: input.kind };
  }
  if (result === "already_active") {
    // Paid some other way meanwhile: keep the credit for next time.
    await store.releaseCredit(transactionId);
    return { status: "already_active", kind: input.kind, targetId: target.id, transactionId };
  }
  return { status: "granted", kind: input.kind, targetId: target.id, transactionId };
}

/** Whether a grant result left the store charge undelivered (kept as credit; worth an alert). */
export function isUndelivered(result: GrantResult): boolean {
  return result.status === "unmatched" || result.status === "amount_mismatch" || result.status === "ineligible";
}

// ─── RevenueCat purchase lookup (client verify path) ─────────────────────────

/**
 * Finds the store purchase for a transaction id in a RevenueCat v2
 * `customers/{id}/purchases` payload. `productStoreIds` maps RevenueCat's
 * internal product ids to store identifiers (same resolution nativeEntitlements
 * uses). Returns null when the customer has no such purchase, so a device can
 * never claim a product it did not buy.
 */
export function findPurchaseInPayload(
  payload: unknown,
  productStoreIds: Record<string, string>,
  transactionId: string,
): { productId: string; transactionId: string } | null {
  const items = (payload as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const rec = item as Record<string, unknown>;
    const ids = [rec.store_purchase_identifier, rec.transaction_id, rec.id].filter((v) => typeof v === "string");
    if (!ids.includes(transactionId)) continue;
    const rawProduct = rec.product_id ?? rec.product_identifier ?? rec.store_product_identifier;
    if (typeof rawProduct !== "string") continue;
    const productId = productStoreIds[rawProduct] ?? rawProduct;
    return { productId, transactionId };
  }
  return null;
}

/** The fields the webhook needs from a RevenueCat consumable purchase event. */
export function promotionPurchaseFromWebhookEvent(event: unknown): {
  appUserId: string; transactionId: string; productId: string;
} | null {
  const e = event as Record<string, unknown> | null;
  if (!e || e.type !== "NON_RENEWING_PURCHASE") return null;
  const { app_user_id: appUserId, transaction_id: tx, original_transaction_id: orig, product_id: productId } = e;
  const transactionId = typeof tx === "string" ? tx : typeof orig === "string" ? orig : null;
  if (typeof appUserId !== "string" || typeof productId !== "string" || !transactionId) return null;
  if (!parsePromoProductId(productId)) return null;
  return { appUserId, transactionId, productId };
}
