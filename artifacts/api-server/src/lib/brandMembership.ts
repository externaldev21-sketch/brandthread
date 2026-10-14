/**
 * Brand membership levels: Member → Insider → Inner Circle, per brand, from
 * the buyer's lifetime spend with that brand (paid orders, not cancelled,
 * net of refunds: the same definition the seller's Customers list uses).
 * Thresholds are the seller's, with defaults. Sellers can open their
 * scheduled drops to Inner Circle early.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, brandMembershipSettings, orders } from "@workspace/db";
import type { DbExecutor } from "./money/ledger";

export type MembershipLevel = "member" | "insider" | "inner_circle";

export const DEFAULT_INSIDER_CENTS = 25_000;      // $250
export const DEFAULT_INNER_CIRCLE_CENTS = 100_000; // $1,000
export const MAX_THRESHOLD_CENTS = 10_000_000;     // $100,000
export const MAX_EARLY_ACCESS_MINUTES = 24 * 60;

export type MembershipSettings = {
  insiderCents: number;
  innerCircleCents: number;
  innerCircleEarlyAccessMinutes: number;
};

export const DEFAULT_SETTINGS: MembershipSettings = {
  insiderCents: DEFAULT_INSIDER_CENTS,
  innerCircleCents: DEFAULT_INNER_CIRCLE_CENTS,
  innerCircleEarlyAccessMinutes: 0,
};

export const LEVEL_LABEL: Record<MembershipLevel, string> = {
  member: "Member",
  insider: "Insider",
  inner_circle: "Inner Circle",
};

/** Null until the first purchase. */
export function levelFor(spendCents: number, s: Pick<MembershipSettings, "insiderCents" | "innerCircleCents">): MembershipLevel | null {
  if (!(spendCents > 0)) return null;
  if (spendCents >= s.innerCircleCents) return "inner_circle";
  if (spendCents >= s.insiderCents) return "insider";
  return "member";
}

export function nextLevel(spendCents: number, s: Pick<MembershipSettings, "insiderCents" | "innerCircleCents">): { level: MembershipLevel; remainingCents: number } | null {
  const level = levelFor(spendCents, s);
  if (level === null || level === "inner_circle") return null;
  if (level === "insider") return { level: "inner_circle", remainingCents: s.innerCircleCents - spendCents };
  return { level: "insider", remainingCents: s.insiderCents - spendCents };
}

export function validateSettings(input: unknown): { ok: true; value: MembershipSettings } | { ok: false; error: string } {
  const v = (input ?? {}) as Record<string, unknown>;
  const insider = Number(v.insiderCents);
  const inner = Number(v.innerCircleCents);
  const early = v.innerCircleEarlyAccessMinutes == null ? 0 : Number(v.innerCircleEarlyAccessMinutes);
  if (![insider, inner, early].every(Number.isInteger)) return { ok: false, error: "Enter whole amounts." };
  if (insider < 100 || inner > MAX_THRESHOLD_CENTS) return { ok: false, error: "Thresholds must be between $1 and $100,000." };
  if (inner <= insider) return { ok: false, error: "Inner Circle must be higher than Insider." };
  if (early < 0 || early > MAX_EARLY_ACCESS_MINUTES) return { ok: false, error: "Early access can be up to 24 hours." };
  return { ok: true, value: { insiderCents: insider, innerCircleCents: inner, innerCircleEarlyAccessMinutes: early } };
}

export async function settingsFor(sellerId: string, executor: DbExecutor = db): Promise<MembershipSettings> {
  const [row] = await executor.select().from(brandMembershipSettings).where(eq(brandMembershipSettings.sellerId, sellerId)).limit(1);
  return row
    ? { insiderCents: row.insiderCents, innerCircleCents: row.innerCircleCents, innerCircleEarlyAccessMinutes: row.innerCircleEarlyAccessMinutes }
    : DEFAULT_SETTINGS;
}

const spendExpr = sql<number>`COALESCE(SUM(GREATEST(${orders.totalCents} - ${orders.refundedCents}, 0)), 0)::bigint`;

/** Lifetime spend per seller for one buyer (only sellers they've bought from). */
export async function spendBySeller(buyerId: string, sellerIds?: string[], executor: DbExecutor = db): Promise<Map<string, number>> {
  const rows = await executor
    .select({ sellerId: orders.ownerId, spent: spendExpr })
    .from(orders)
    .where(and(
      eq(orders.buyerId, buyerId),
      ne(orders.status, "cancelled"),
      sql`${orders.paidAt} IS NOT NULL`,
      ne(orders.ownerId, buyerId),
      sellerIds ? inArray(orders.ownerId, sellerIds) : undefined,
    ))
    .groupBy(orders.ownerId);
  return new Map(rows.map((r) => [r.sellerId, Number(r.spent)]));
}

export type Membership = {
  sellerId: string;
  level: MembershipLevel | null;
  spendCents: number;
  next: { level: MembershipLevel; remainingCents: number } | null;
};

export async function membershipFor(sellerId: string, buyerId: string, executor: DbExecutor = db): Promise<Membership> {
  const [spend, settings] = await Promise.all([
    spendBySeller(buyerId, [sellerId], executor).then((m) => m.get(sellerId) ?? 0),
    settingsFor(sellerId, executor),
  ]);
  return { sellerId, level: levelFor(spend, settings), spendCents: spend, next: nextLevel(spend, settings) };
}

/** Every brand the buyer has bought from, with their level there, highest spend first. */
export async function membershipsFor(buyerId: string, executor: DbExecutor = db): Promise<Membership[]> {
  const spend = await spendBySeller(buyerId, undefined, executor);
  const sellerIds = [...spend.keys()].filter(Boolean);
  if (sellerIds.length === 0) return [];
  const rows = await executor.select().from(brandMembershipSettings).where(inArray(brandMembershipSettings.sellerId, sellerIds));
  const bySeller = new Map(rows.map((r) => [r.sellerId, r]));
  return sellerIds
    .map((sellerId) => {
      const s = bySeller.get(sellerId) ?? DEFAULT_SETTINGS;
      const cents = spend.get(sellerId) ?? 0;
      return { sellerId, level: levelFor(cents, s), spendCents: cents, next: nextLevel(cents, s) };
    })
    .filter((m) => m.level !== null)
    .sort((a, b) => b.spendCents - a.spendCents);
}

/**
 * Minutes before a scheduled launch that `buyerId` may buy from `sellerId`:
 * the seller's Inner Circle early access when the buyer is Inner Circle there,
 * else 0.
 */
export async function earlyAccessMinutesFor(sellerId: string, buyerId: string | null | undefined, executor: DbExecutor = db): Promise<number> {
  if (!buyerId || buyerId === sellerId) return 0;
  const settings = await settingsFor(sellerId, executor);
  if (settings.innerCircleEarlyAccessMinutes <= 0) return 0;
  const spend = (await spendBySeller(buyerId, [sellerId], executor)).get(sellerId) ?? 0;
  return levelFor(spend, settings) === "inner_circle" ? settings.innerCircleEarlyAccessMinutes : 0;
}
