/**
 * Pure rules for the F6 live-commerce additions (unit-tested in
 * lib/__tests__/liveShopping.test.ts):
 *
 *  - flash deals: a live-only code can run for a fixed window (5/10/15 min);
 *    the server sets expires_at, and lib/discounts.ts already rejects a code
 *    after expires_at.
 *  - live gifts: Brandthread keeps LIVE_GIFT_PLATFORM_FEE_BPS of every Thread
 *    Cash gift; the seller is credited the rest.
 *  - "just bought" ticker: only a first name or a handle is ever shown.
 */

/** Durations (minutes) a host may give a live flash deal. */
export const FLASH_DEAL_MINUTES = [5, 10, 15] as const;

/**
 * The expiry for a flash deal of `minutes` starting `now`, or null when the
 * request didn't ask for one. Throws on a duration outside the allowed list.
 */
export function flashDealExpiry(minutes: unknown, now: Date = new Date()): Date | null {
  if (minutes === undefined || minutes === null) return null;
  const n = Number(minutes);
  if (!(FLASH_DEAL_MINUTES as readonly number[]).includes(n)) {
    throw new RangeError(`durationMinutes must be one of ${FLASH_DEAL_MINUTES.join(", ")}`);
  }
  return new Date(now.getTime() + n * 60_000);
}

export const DEFAULT_LIVE_GIFT_FEE_BPS = 3000;
export const MAX_LIVE_GIFT_FEE_BPS = 9000;

/** LIVE_GIFT_PLATFORM_FEE_BPS, defaulting to 30% and clamped to 0..90%. */
export function liveGiftFeeBps(raw: string | undefined = process.env.LIVE_GIFT_PLATFORM_FEE_BPS): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LIVE_GIFT_FEE_BPS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIVE_GIFT_FEE_BPS;
  return Math.min(MAX_LIVE_GIFT_FEE_BPS, Math.max(0, Math.round(n)));
}

/**
 * Splits a gift into the platform fee and the seller's credit. The fee rounds
 * down (the seller never loses a fraction of a cent to rounding), so
 * fee + net always equals the gift.
 */
export function splitLiveGift(grossCents: number, feeBps: number): { feeCents: number; netCents: number } {
  if (!Number.isInteger(grossCents) || grossCents < 0) throw new RangeError("grossCents must be a whole number of cents");
  const bps = Math.min(MAX_LIVE_GIFT_FEE_BPS, Math.max(0, Math.round(feeBps)));
  const feeCents = Math.floor((grossCents * bps) / 10_000);
  return { feeCents, netCents: grossCents - feeCents };
}

/**
 * Who appears in a live's "just bought" / "sent a gift" row: the first word
 * of the person's name, else their @handle, else "Someone". Never a full
 * name or an email.
 */
export function publicBuyerName(input: { displayName?: string | null; username?: string | null }): string {
  const first = (input.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (first && !first.includes("@")) return first.slice(0, 24);
  const handle = (input.username ?? "").trim().replace(/^@/, "");
  if (handle) return `@${handle.slice(0, 30)}`;
  return "Someone";
}

/** "just bought Linen Blazer" / "just bought Linen Blazer and 2 more". */
export function purchaseText(productTitles: string[]): string {
  const titles = productTitles.map((t) => t.trim()).filter(Boolean);
  if (titles.length === 0) return "just bought";
  const first = titles[0].slice(0, 60);
  return titles.length === 1 ? `just bought ${first}` : `just bought ${first} and ${titles.length - 1} more`;
}
