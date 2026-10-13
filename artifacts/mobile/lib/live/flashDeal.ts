/**
 * Live flash deals (a live-only code with a 5/10/15 minute timer, Whatnot
 * style: a red mm:ss countdown next to the deal). Pure — unit-tested in
 * tests/live-flash-deal.test.ts.
 */

/** Durations the host can pick; null = no timer (lasts the whole live). */
export const FLASH_DEAL_DURATIONS: Array<{ label: string; minutes: number | null }> = [
  { label: 'No timer', minutes: null },
  { label: '5 min', minutes: 5 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
];

/** Milliseconds left, or null when the deal has no timer. Never negative. */
export function dealRemainingMs(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - now);
}

/** "14:59", "0:07". Rounds up so a deal never reads 0:00 while still live. */
export function formatDealCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Drops codes whose timer has run out — expired deals disappear. */
export function activeDeals<T extends { expiresAt?: string | null }>(codes: readonly T[], now: number): T[] {
  return codes.filter(c => {
    const left = dealRemainingMs(c.expiresAt, now);
    return left === null || left > 0;
  });
}

/** Adds or replaces a code by id (the `liveCode` socket event), newest first. */
export function upsertDeal<T extends { id: string }>(codes: readonly T[], code: T): T[] {
  return [code, ...codes.filter(c => c.id !== code.id)];
}
