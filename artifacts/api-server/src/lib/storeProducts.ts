/**
 * Every App Store / Google Play product the native apps sell through
 * RevenueCat, in one place. docs/app-store/iap-products.md is the human copy
 * Dev follows in App Store Connect; storeProducts.test.ts keeps the two in sync.
 *
 * Prices are not defined here: subscriptions read PLAN_CATALOGUE, credit packs
 * read CREDIT_PACKS, Featured reads FEATURED_PRICE_LIST, and Boost / Create-ad
 * tiers are the budget itself. The store price is the nearest App Store price
 * point to that amount.
 */
import { PLAN_CATALOGUE, type SellerPlanId } from "./planCatalogue";
import { CREDIT_PACKS } from "./aiCredits/catalogue";
import { RC_CREDIT_PRODUCTS } from "./aiCredits/purchases";
import { FEATURED_DURATIONS, FEATURED_PRICE_LIST } from "./promotions/featured";
import { IAP_PROMO_TIER_DOLLARS, featuredProductId, promoProductId } from "./iapPromotions";

export type StoreProductType = "auto_renewable_subscription" | "consumable";

export type StoreProduct = {
  productId: string;
  type: StoreProductType;
  /** What it unlocks, for the App Store Connect reference name. */
  label: string;
  priceCents: number;
  /** RevenueCat offering package ($bt_*) or entitlement, when one is needed. */
  revenueCat?: string;
};

/** Store ids for the seller plans (RevenueCat maps them back in nativeEntitlements.ts). */
export const SUBSCRIPTION_PRODUCT_IDS: Record<SellerPlanId, string> = {
  starter: "brandthread_starter_monthly",
  growth: "brandthread_growth_monthly",
  pro: "brandthread_pro_monthly",
};

export function storeProducts(): StoreProduct[] {
  const subscriptions = (Object.keys(SUBSCRIPTION_PRODUCT_IDS) as SellerPlanId[]).map((plan) => ({
    productId: SUBSCRIPTION_PRODUCT_IDS[plan],
    type: "auto_renewable_subscription" as const,
    label: PLAN_CATALOGUE[plan].name,
    priceCents: PLAN_CATALOGUE[plan].amountCents,
    revenueCat: `offering package $bt_${plan}`,
  }));
  const packs = Object.entries(RC_CREDIT_PRODUCTS).map(([productId, packId]) => {
    const pack = CREDIT_PACKS.find((p) => p.id === packId)!;
    return { productId, type: "consumable" as const, label: `AI credits · ${pack.label}`, priceCents: pack.amountCents };
  });
  const budgets = (["boost", "ad_campaign"] as const).flatMap((kind) =>
    IAP_PROMO_TIER_DOLLARS.map((dollars) => ({
      productId: promoProductId(kind, dollars),
      type: "consumable" as const,
      label: `${kind === "boost" ? "Boost" : "Ad campaign"} · $${dollars} budget`,
      priceCents: dollars * 100,
    })));
  const featured = FEATURED_DURATIONS.map((days) => ({
    productId: featuredProductId(days),
    type: "consumable" as const,
    label: `Featured on Discover · ${days} days`,
    priceCents: FEATURED_PRICE_LIST[days],
  }));
  return [...subscriptions, ...packs, ...budgets, ...featured];
}
