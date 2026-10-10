/** A store's gift card setting: whether it sells gift cards, at which amounts, and how long they last. */
import { and, eq, gt, sql } from "drizzle-orm";
import { db, giftCards, giftCardSettings } from "@workspace/db";
import { GiftCardError, MAX_GIFT_CARD_CENTS, MIN_GIFT_CARD_CENTS } from "./service";

/**
 * How many gift cards a store may issue itself per rolling 24 hours
 * (GIFT_CARD_SELLER_ISSUE_DAILY_LIMIT, default 20). Seller-issued cards are
 * funded by the store (payout.ts), so this only limits spam and mistakes.
 */
export function sellerIssueDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.GIFT_CARD_SELLER_ISSUE_DAILY_LIMIT);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : 20;
}

/** Throws once the store has issued its daily allowance of its own gift cards. */
export async function assertSellerMayIssue(sellerId: string, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(giftCards).where(and(
    eq(giftCards.sellerId, sellerId), eq(giftCards.source, "seller_issued"), gt(giftCards.createdAt, since),
  ));
  if ((row?.n ?? 0) >= sellerIssueDailyLimit()) {
    throw new GiftCardError(429, "GIFT_CARD_ISSUE_LIMIT", "You've issued the most gift cards allowed today. Try again tomorrow.");
  }
}

export const DEFAULT_DENOMINATIONS = [2500, 5000, 10000];
export const MAX_DENOMINATIONS = 6;

export type GiftCardSettingsView = {
  sellerId: string;
  enabled: boolean;
  denominations: number[];
  allowCustom: boolean;
  expiryMonths: number | null;
  minCents: number;
  maxCents: number;
};

export async function getGiftCardSettings(sellerId: string): Promise<GiftCardSettingsView> {
  const [row] = await db.select().from(giftCardSettings).where(eq(giftCardSettings.sellerId, sellerId)).limit(1);
  return {
    sellerId,
    enabled: row?.enabled ?? false,
    denominations: row?.denominations ?? DEFAULT_DENOMINATIONS,
    allowCustom: row?.allowCustom ?? false,
    expiryMonths: row?.expiryMonths ?? null,
    minCents: MIN_GIFT_CARD_CENTS,
    maxCents: MAX_GIFT_CARD_CENTS,
  };
}

export function normalizeDenominations(input: number[]): number[] {
  const unique = [...new Set(input)];
  if (unique.length === 0 || unique.length > MAX_DENOMINATIONS) {
    throw new GiftCardError(400, "INVALID_DENOMINATIONS", `Choose between 1 and ${MAX_DENOMINATIONS} amounts.`);
  }
  for (const cents of unique) {
    if (!Number.isSafeInteger(cents) || cents < MIN_GIFT_CARD_CENTS || cents > MAX_GIFT_CARD_CENTS) {
      throw new GiftCardError(400, "INVALID_DENOMINATIONS", "Amounts must be between $5 and $1,000.");
    }
  }
  return unique.sort((a, b) => a - b);
}

export async function saveGiftCardSettings(sellerId: string, patch: {
  enabled?: boolean; denominations?: number[]; allowCustom?: boolean; expiryMonths?: number | null;
}): Promise<GiftCardSettingsView> {
  const current = await getGiftCardSettings(sellerId);
  const next = {
    enabled: patch.enabled ?? current.enabled,
    denominations: patch.denominations ? normalizeDenominations(patch.denominations) : current.denominations,
    allowCustom: patch.allowCustom ?? current.allowCustom,
    expiryMonths: patch.expiryMonths === undefined ? current.expiryMonths : patch.expiryMonths,
  };
  if (next.expiryMonths != null && (!Number.isInteger(next.expiryMonths) || next.expiryMonths < 1 || next.expiryMonths > 120)) {
    throw new GiftCardError(400, "INVALID_EXPIRY", "Expiry must be between 1 and 120 months.");
  }
  await db.insert(giftCardSettings).values({ sellerId, ...next }).onConflictDoUpdate({
    target: giftCardSettings.sellerId,
    set: { ...next, updatedAt: new Date() },
  });
  return getGiftCardSettings(sellerId);
}

/** Throws unless the store sells this amount. */
export function assertSellable(settings: GiftCardSettingsView, amountCents: number): void {
  if (!settings.enabled) throw new GiftCardError(400, "GIFT_CARDS_DISABLED", "This store doesn't sell gift cards right now.");
  if (!settings.allowCustom && !settings.denominations.includes(amountCents)) {
    throw new GiftCardError(400, "INVALID_AMOUNT", "Choose one of the amounts this store offers.");
  }
}

export function expiryFromMonths(months: number | null, from = new Date()): Date | null {
  if (!months) return null;
  const at = new Date(from);
  at.setMonth(at.getMonth() + months);
  return at;
}
