/**
 * Native in-app purchases for Boost and Create-ad (App Store Guideline 3.1.1).
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

export type PromoKind = "boost" | "ad_campaign";

/** Whole-dollar budgets sold natively. Every tier is a valid existing budget step. */
export const IAP_PROMO_TIER_DOLLARS = [5, 10, 25, 50, 100, 250, 500] as const;

const PRODUCT_PREFIX: Record<PromoKind, string> = {
  boost: "brandthread_boost_",
  ad_campaign: "brandthread_ad_",
};

export function promoProductId(kind: PromoKind, dollars: number): string {
  return `${PRODUCT_PREFIX[kind]}${dollars}`;
}

/** Every product id Dev must create in App Store Connect / Play / RevenueCat. */
export function allPromoProductIds(): string[] {
  return (Object.keys(PRODUCT_PREFIX) as PromoKind[]).flatMap((kind) =>
    IAP_PROMO_TIER_DOLLARS.map((d) => promoProductId(kind, d)),
  );
}

/** Returns the kind + budget a product id sells, or null when it is not a promotion product. */
export function parsePromoProductId(raw: unknown): { kind: PromoKind; amountCents: number } | null {
  if (typeof raw !== "string") return null;
  // Play Billing may report "product:base-plan"; consumables have none, tolerate it anyway.
  const id = raw.split(":")[0];
  for (const kind of Object.keys(PRODUCT_PREFIX) as PromoKind[]) {
    const prefix = PRODUCT_PREFIX[kind];
    if (!id.startsWith(prefix)) continue;
    const dollars = Number(id.slice(prefix.length));
    if ((IAP_PROMO_TIER_DOLLARS as readonly number[]).includes(dollars)) {
      return { kind, amountCents: dollars * 100 };
    }
  }
  return null;
}

/** Feature flag. Off unless Dev has created the store products and flips it. */
export function iapPromotionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.IAP_PROMOTIONS_ENABLED === "true";
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
