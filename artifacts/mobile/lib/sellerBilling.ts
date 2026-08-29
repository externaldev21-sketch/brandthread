export const SELLER_PACKAGE_IDS = {
  starter: '$bt_starter',
  growth: '$bt_growth',
  scale: '$bt_scale',
} as const;

export type SellerPlanId = keyof typeof SELLER_PACKAGE_IDS;

export function isSellerRevenueCatPackage(identifier: string): identifier is typeof SELLER_PACKAGE_IDS[SellerPlanId] {
  return Object.values(SELLER_PACKAGE_IDS).includes(identifier as typeof SELLER_PACKAGE_IDS[SellerPlanId]);
}