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
/**
 * The platform's own subscription settings, for when the provider gave no
 * management URL (RevenueCat customer info not loaded yet, or no provider
 * recorded). Null on web, where there is no store to send people to.
 */
export function platformSubscriptionSettingsUrl(platformOS: string): string | null {
  if (platformOS === 'ios') return 'https://apps.apple.com/account/subscriptions';
  if (platformOS === 'android') return 'https://play.google.com/store/account/subscriptions';
  return null;
}
