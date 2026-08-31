import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, sellerSubscriptionEntitlements, users } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";

export type NativeEntitlementStatus = "active" | "trial" | "grace" | "expired";
export type SellerPlanId = "starter" | "growth" | "scale";

const PRODUCT_TO_PLAN: Record<string, SellerPlanId> = {
  brandthread_starter_monthly: "starter",
  "brandthread_starter_monthly:monthly": "starter",
  brandthread_growth_monthly: "growth",
  "brandthread_growth_monthly:monthly": "growth",
  brandthread_scale_monthly: "scale",
  "brandthread_scale_monthly:monthly": "scale",
};
const PLAN_RANK: Record<SellerPlanId, number> = { starter: 0, growth: 1, scale: 2 };
const connectors = new ReplitConnectors();

type ProviderSubscription = Record<string, unknown>;

function dateFrom(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(typeof value === "number" ? value * (value < 10_000_000_000 ? 1000 : 1) : value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function findSubscriptions(
  value: unknown,
  productIdentifiers: Record<string, string>,
  found: ProviderSubscription[] = [],
): ProviderSubscription[] {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((item) => findSubscriptions(item, productIdentifiers, found));
    return found;
  }
  const record = value as ProviderSubscription;
  const rawProduct = record.product_identifier ?? record.product_id ?? record.store_product_identifier;
  const product = typeof rawProduct === "string" ? productIdentifiers[rawProduct] ?? rawProduct : rawProduct;
  if (typeof product === "string" && PRODUCT_TO_PLAN[product]) {
    found.push({ ...record, product_identifier: product });
  }
  Object.values(record).forEach((item) => {
    if (item && typeof item === "object") findSubscriptions(item, productIdentifiers, found);
  });
  return found;
}

function normalizeSubscription(subscription: ProviderSubscription) {
  const productIdentifier = String(
    subscription.product_identifier ?? subscription.product_id ?? subscription.store_product_identifier,
  );
  const planId = PRODUCT_TO_PLAN[productIdentifier];
  const expiresAt = dateFrom(
    subscription.expires_at ?? subscription.expires_date ?? subscription.current_period_ends_at
      ?? subscription.current_period_end_at,
  );
  const trialEndsAt = dateFrom(subscription.trial_ends_at ?? subscription.trial_end_at);
  const providerUpdatedAt = dateFrom(subscription.updated_at ?? subscription.purchase_date ?? subscription.started_at);
  const now = Date.now();
  const statusText = String(subscription.status ?? "").toLowerCase();
  const periodType = String(subscription.period_type ?? "").toLowerCase();
  // The native products in scope are subscriptions. No expiry from RevenueCat
  // is not evidence of access, so fail closed rather than accepting a claim.
  const validUntil = !!expiresAt && expiresAt.valueOf() > now;
  let status: NativeEntitlementStatus = "expired";
  if (validUntil && (statusText.includes("grace") || statusText.includes("retry"))) status = "grace";
  else if (validUntil && (statusText.includes("trial") || periodType === "trial")) status = "trial";
  else if (validUntil && (statusText === "active" || statusText === "subscribed" || !statusText)) status = "active";
  return {
    planId,
    status,
    expiresAt,
    trialEndsAt,
    providerUpdatedAt,
    productIdentifier,
    isSandbox: Boolean(subscription.is_sandbox ?? subscription.sandbox),
  };
}

/**
 * Reads RevenueCat directly through Replit's authenticated connector, never
 * trusting a device-provided product or entitlement claim.
 */
export async function reconcileRevenueCatEntitlement(clerkUserId: string) {
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!projectId) throw new Error("REVENUECAT_PROJECT_ID is required to reconcile native subscriptions");

  // Lock before the provider read, not merely before the write: concurrent
  // webhook deliveries then observe and persist live state in one order.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`revenuecat:${clerkUserId}`}))`);
    const basePath = `/v2/projects/${encodeURIComponent(projectId)}`;
  const [subscriptionResponse, productsResponse] = await Promise.all([
    connectors.proxy("revenuecat", `${basePath}/customers/${encodeURIComponent(clerkUserId)}/subscriptions?limit=100`, {
      method: "GET", headers: { Accept: "application/json" },
    }),
    // Subscription records reference RevenueCat product IDs; resolve those
    // server-side to their store identifiers before applying the allow-list.
    connectors.proxy("revenuecat", `${basePath}/products?limit=100`, {
      method: "GET", headers: { Accept: "application/json" },
    }),
  ]);
  const [text, productsText] = await Promise.all([subscriptionResponse.text(), productsResponse.text()]);
  if (!subscriptionResponse.ok) {
    throw new Error(`RevenueCat subscription lookup failed (${subscriptionResponse.status}): ${text.slice(0, 500)}`);
  }
  if (!productsResponse.ok) {
    throw new Error(`RevenueCat product lookup failed (${productsResponse.status}): ${productsText.slice(0, 500)}`);
  }
  const payload = text ? JSON.parse(text) as unknown : {};
  const products = productsText ? JSON.parse(productsText) as { items?: Array<{ id?: string; store_identifier?: string }> } : {};
  const productIdentifiers = Object.fromEntries(
    (products.items ?? []).flatMap((product) =>
      product.id && product.store_identifier ? [[product.id, product.store_identifier]] : [],
    ),
  );
  const candidates = findSubscriptions(payload, productIdentifiers).map(normalizeSubscription);
  const selected = candidates
    .sort((a, b) => (b.status === "expired" ? 0 : 1) - (a.status === "expired" ? 0 : 1)
      || PLAN_RANK[b.planId] - PLAN_RANK[a.planId]
      || (b.providerUpdatedAt?.valueOf() ?? 0) - (a.providerUpdatedAt?.valueOf() ?? 0))[0];
  const record = selected ?? {
    planId: "starter" as SellerPlanId,
    status: "expired" as NativeEntitlementStatus,
    expiresAt: null,
    trialEndsAt: null,
    providerUpdatedAt: null,
    productIdentifier: null,
    isSandbox: false,
  };

  await tx.insert(sellerSubscriptionEntitlements).values({
    clerkUserId,
    provider: "revenuecat",
    ...record,
    lastSyncedAt: new Date(),
    providerData: payload as Record<string, unknown>,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [sellerSubscriptionEntitlements.provider, sellerSubscriptionEntitlements.clerkUserId],
    set: {
      planId: record.planId, status: record.status, expiresAt: record.expiresAt,
      trialEndsAt: record.trialEndsAt, isSandbox: record.isSandbox,
      productIdentifier: record.productIdentifier, providerUpdatedAt: record.providerUpdatedAt,
      lastSyncedAt: new Date(), providerData: payload as Record<string, unknown>, updatedAt: new Date(),
    },
  });
  return record;
  });
}

export type EffectiveEntitlement = {
  planId: SellerPlanId;
  status: string;
  provider: "stripe" | "revenuecat" | "none";
  native: typeof sellerSubscriptionEntitlements.$inferSelect | null;
};

type LegacySubscription = {
  planId: string | null;
  status: string | null;
} | null | undefined;

type NativeSubscription = typeof sellerSubscriptionEntitlements.$inferSelect | null | undefined;

function sellerPlanId(value: unknown): SellerPlanId | null {
  if (value === "starter" || value === "growth" || value === "scale") return value;
  return null;
}

/**
 * Resolve access from the two seller subscription providers.
 *
 * This is intentionally independent of the database query so provider
 * disagreement remains easy to exercise in tests. Only recognized plans and
 * currently valid provider states can grant access; an unrecognized record is
 * treated as unavailable rather than being allowed to fall through as a
 * paid plan.
 */
export function resolveEffectiveEntitlement(
  legacy: LegacySubscription,
  native: NativeSubscription,
  now = new Date(),
): EffectiveEntitlement {
  const nativePlan = sellerPlanId(native?.planId);
  const nativeStatus = typeof native?.status === "string" ? native.status.toLowerCase() : "";
  const nativeActive = !!native
    && !!nativePlan
    && ["active", "trial", "grace"].includes(nativeStatus)
    && !!native.expiresAt
    && native.expiresAt.valueOf() > now.valueOf();

  const legacyPlan = legacy?.planId === "pro" ? "scale" : sellerPlanId(legacy?.planId);
  const legacyStatus = typeof legacy?.status === "string" ? legacy.status.toLowerCase() : "";
  const stripeActive = !!legacyPlan && ["active", "trialing", "past_due"].includes(legacyStatus);

  if (
    nativeActive
    && nativePlan
    && (!stripeActive || PLAN_RANK[nativePlan] >= PLAN_RANK[legacyPlan!])
  ) {
    return {
      planId: nativePlan,
      status: native?.status ?? "none",
      provider: "revenuecat",
      native: native ?? null,
    };
  }

  if (stripeActive && legacyPlan) {
    return {
      planId: legacyPlan,
      status: legacy?.status ?? "none",
      provider: "stripe",
      native: native ?? null,
    };
  }

  return { planId: "starter", status: "none", provider: "none", native: native ?? null };
}

/** Shared effective access calculation. Stripe data remains untouched for all legacy web subscribers. */
export async function getEffectiveEntitlement(clerkUserId: string): Promise<EffectiveEntitlement> {
  const [[legacy], [native]] = await Promise.all([
    db.select({ planId: users.subscriptionPlanId, status: users.subscriptionStatus })
      .from(users).where(eq(users.clerkId, clerkUserId)).limit(1),
    db.select().from(sellerSubscriptionEntitlements)
      .where(and(eq(sellerSubscriptionEntitlements.clerkUserId, clerkUserId), eq(sellerSubscriptionEntitlements.provider, "revenuecat")))
      .orderBy(desc(sellerSubscriptionEntitlements.lastSyncedAt)).limit(1),
  ]);
  return resolveEffectiveEntitlement(legacy, native);
}