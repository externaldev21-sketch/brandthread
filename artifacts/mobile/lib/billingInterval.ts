/**
 * Monthly / yearly billing for seller plans (item 116: "2 months free").
 *
 * A year costs 10 × the monthly price — the same rule the server charges
 * (api-server lib/billing/annual.ts), so the numbers shown here are exactly
 * what Stripe checkout bills:
 *   Starter $199.90/yr · Growth $490/yr · Pro $1,290/yr
 *
 * Native (App Store / Google Play) yearly plans come from RevenueCat: the
 * current offering must contain the annual packages below (products
 * brandthread_<plan>_annual). Until all three are there, the app hides the
 * Monthly / Yearly toggle on iOS and Android and sells monthly only.
 */
import type { SellerPlanDefinition } from './sellerPlans';
import { SELLER_ANNUAL_PACKAGE_IDS, type SellerPlanId } from './sellerBilling';

export type BillingInterval = 'month' | 'year';

export const ANNUAL_MONTHS_CHARGED = 10;
export const ANNUAL_SAVINGS_LABEL = '2 months free';

export function annualPriceCents(plan: Pick<SellerPlanDefinition, 'priceCents'>): number {
  return plan.priceCents * ANNUAL_MONTHS_CHARGED;
}

function dollars(cents: number): string {
  const value = cents / 100;
  return Number.isInteger(value)
    ? `$${value.toLocaleString('en-US')}`
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$490" / "/yr" / "$40.83/mo billed yearly" for a plan card (web / Stripe). */
export function yearlyDisplayFor(plan: Pick<SellerPlanDefinition, 'priceCents'>): {
  price: string;
  period: string;
  note: string;
} {
  const yearly = annualPriceCents(plan);
  const perMonth = Math.round(yearly / 12) / 100;
  return {
    price: dollars(yearly),
    period: '/yr',
    note: `$${perMonth.toFixed(2)}/mo billed yearly`,
  };
}

type PackageLike = { identifier: string; product: { priceString: string; pricePerMonthString?: string | null } };

export function annualPackageFor<P extends PackageLike>(packages: P[], planId: SellerPlanId): P | undefined {
  return packages.find((pkg) => pkg.identifier === SELLER_ANNUAL_PACKAGE_IDS[planId]);
}

/** Yearly is offered natively only when the offering has every annual package. */
export function hasNativeAnnualOffering(packages: PackageLike[]): boolean {
  return (Object.keys(SELLER_ANNUAL_PACKAGE_IDS) as SellerPlanId[])
    .every((planId) => !!annualPackageFor(packages, planId));
}

/** Whether to show the Monthly / Yearly toggle on this platform. */
export function canOfferYearly(platformOS: string, packages: PackageLike[]): boolean {
  return platformOS === 'web' || hasNativeAnnualOffering(packages);
}
