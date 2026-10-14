/** Brand membership level words (server: lib/brandMembership.ts). */
import type { MembershipLevel } from '@/lib/api';

export const LEVEL_LABEL: Record<MembershipLevel, string> = {
  member: 'Member',
  insider: 'Insider',
  inner_circle: 'Inner Circle',
};

export const DEFAULT_LEVEL_SETTINGS = { insiderCents: 25_000, innerCircleCents: 100_000, innerCircleEarlyAccessMinutes: 0 };

/** Insider or above with any brand unlocks the chrome/silver app icons (Settings > App icon). */
export function levelRank(level: MembershipLevel | null | undefined): number {
  return level === 'inner_circle' ? 2 : level === 'insider' ? 1 : level === 'member' ? 0 : -1;
}

/** "$250" from cents, whole dollars (thresholds are whole-dollar amounts). */
export function wholeDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** Parse a typed dollar amount ("1,000", "$250") into cents; null when not a positive whole amount. */
export function parseDollars(text: string): number | null {
  const n = Number(text.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n * 100;
}
