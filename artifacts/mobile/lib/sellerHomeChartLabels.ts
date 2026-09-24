/**
 * Pure x-axis label formatting for the seller dashboard's Sales activity
 * chart. Kept free of any React Native imports so it can be unit tested
 * directly (and reused) without mounting the dashboard component.
 *
 * Deliberately avoids toLocaleDateString/toLocaleTimeString: RN Hermes' Intl
 * support for the `weekday` option is unreliable and was rendering every
 * "This week" bucket as the same truncated string ("WE WE WE ..."). Date's
 * plain getters (getDay/getHours/getMinutes) always reflect the device's
 * local time zone, so this stays correct without depending on ICU/Intl.
 */

export type SellerHomeTimeRange = 'live' | 'today' | 'yesterday' | 'week';

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function formatClockLabel(date: Date, includeMinutes: boolean): string {
  const hour24 = date.getHours();
  const period = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  if (!includeMinutes) return `${hour12} ${period}`;
  return `${hour12}:${String(date.getMinutes()).padStart(2, '0')} ${period}`;
}

export function bucketLabel(value: string, range: SellerHomeTimeRange): string {
  const date = new Date(value);
  if (range === 'week') {
    return WEEKDAY_LABELS[date.getDay()];
  }
  return formatClockLabel(date, range === 'live');
}
