/**
 * Free-trial length of a store product's intro offer, in days. Null when the
 * product has no intro offer or the offer isn't free (a discounted intro
 * price is not a free trial). Reads the store's own period, so the paywall
 * never promises a trial length the purchase sheet won't honour.
 */
type IntroPrice = { price?: number; periodUnit?: string; periodNumberOfUnits?: number } | null | undefined;

const DAYS_PER_UNIT: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

export function freeTrialDays(intro: IntroPrice): number | null {
  if (!intro || (intro.price ?? 0) > 0) return null;
  const perUnit = DAYS_PER_UNIT[String(intro.periodUnit ?? '').toUpperCase()];
  const units = intro.periodNumberOfUnits ?? 0;
  if (!perUnit || units <= 0) return null;
  return perUnit * units;
}

/** The "manage or cancel" line of the auto-renew disclosure, per platform. */
export function manageOrCancelLine(platformOS: string): string {
  if (platformOS === 'android') return 'Manage or cancel in Google Play subscriptions.';
  if (platformOS === 'ios') return 'Manage or cancel in your App Store account settings.';
  return 'Manage or cancel any time from Subscription in Settings.';
}
