export type SubscriptionBillingProvider = 'stripe' | 'revenuecat' | 'none';

export function isSubscriptionPaymentRecoveryRequired(status: string | null | undefined): boolean {
  return status === 'past_due' || status === 'unpaid';
}

export function getBillingRecoveryTarget(
  provider: SubscriptionBillingProvider,
  revenueCatManagementURL: string | null | undefined,
): 'stripe' | 'revenuecat' | 'subscription' {
  if (provider === 'stripe') return 'stripe';
  if (provider === 'revenuecat' && revenueCatManagementURL) return 'revenuecat';
  return 'subscription';
}