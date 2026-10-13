export const SELLER_PACKAGE_IDS = {
  starter: '$bt_starter',
  growth: '$bt_growth',
  pro: '$bt_pro',
} as const;

export type SellerPlanId = keyof typeof SELLER_PACKAGE_IDS;

/**
 * Yearly packages (item 116) in the current RevenueCat offering, for the
 * App Store / Play products brandthread_<plan>_annual. Optional: when any is
 * missing the app sells monthly only on native.
 */
export const SELLER_ANNUAL_PACKAGE_IDS = {
  starter: '$bt_starter_annual',
  growth: '$bt_growth_annual',
  pro: '$bt_pro_annual',
} as const satisfies Record<SellerPlanId, string>;

type SellerPackageId = typeof SELLER_PACKAGE_IDS[SellerPlanId] | typeof SELLER_ANNUAL_PACKAGE_IDS[SellerPlanId];

export function isSellerRevenueCatPackage(identifier: string): identifier is SellerPackageId {
  return Object.values(SELLER_PACKAGE_IDS).includes(identifier as typeof SELLER_PACKAGE_IDS[SellerPlanId])
    || Object.values(SELLER_ANNUAL_PACKAGE_IDS).includes(identifier as typeof SELLER_ANNUAL_PACKAGE_IDS[SellerPlanId]);
}