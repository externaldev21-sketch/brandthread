/**
 * Seller milestones (migration 291): first sale, $1K / $10K / $100K in sales,
 * 100 and 1,000 orders. Pure definitions and ranking, unit tested without a
 * database; the route (routes/seller-milestones.ts) does the reads/writes.
 *
 * Sales = sum over paid, non-cancelled orders of (total - refunded), each
 * order floored at 0. Orders = count of paid, non-cancelled orders.
 */

export type MilestoneKey = "first_sale" | "sales_1k" | "orders_100" | "sales_10k" | "orders_1000" | "sales_100k";

export interface MilestoneDef {
  key: MilestoneKey;
  label: string;
  metric: "orders" | "salesCents";
  threshold: number;
}

/**
 * Lowest to highest. Sales and order milestones interleave by how hard they
 * are to reach at a typical order value (~$50): 100 orders lands between
 * $1K and $10K, 1,000 orders between $10K and $100K.
 */
export const MILESTONES: readonly MilestoneDef[] = [
  { key: "first_sale", label: "First sale", metric: "orders", threshold: 1 },
  { key: "sales_1k", label: "$1,000 in sales", metric: "salesCents", threshold: 1_000 * 100 },
  { key: "orders_100", label: "100 orders", metric: "orders", threshold: 100 },
  { key: "sales_10k", label: "$10,000 in sales", metric: "salesCents", threshold: 10_000 * 100 },
  { key: "orders_1000", label: "1,000 orders", metric: "orders", threshold: 1_000 },
  { key: "sales_100k", label: "$100,000 in sales", metric: "salesCents", threshold: 100_000 * 100 },
];

const RANK = new Map(MILESTONES.map((m, i) => [m.key, i]));

export function isMilestoneKey(raw: unknown): raw is MilestoneKey {
  return typeof raw === "string" && RANK.has(raw as MilestoneKey);
}

export function milestoneRank(key: MilestoneKey): number {
  return RANK.get(key) ?? -1;
}

export function milestoneLabel(key: MilestoneKey): string {
  return MILESTONES[milestoneRank(key)]?.label ?? key;
}

export interface SellerTotals { orders: number; salesCents: number }

/** Every milestone the totals have reached, lowest first. */
export function reachedMilestones(totals: SellerTotals): MilestoneKey[] {
  return MILESTONES.filter((m) => totals[m.metric] >= m.threshold).map((m) => m.key);
}

/** The highest of `keys`, or null. */
export function highestMilestone(keys: readonly MilestoneKey[]): MilestoneKey | null {
  let best: MilestoneKey | null = null;
  for (const key of keys) if (best === null || milestoneRank(key) > milestoneRank(best)) best = key;
  return best;
}

/**
 * Of the unseen milestones, the one to surface and the ones it supersedes
 * (marked seen without ever showing). A seller who arrives at $50K with no
 * history in the table sees "$10,000 in sales", never "First sale".
 */
export function planSurface(unseen: readonly MilestoneKey[]): { surface: MilestoneKey | null; supersede: MilestoneKey[] } {
  const surface = highestMilestone(unseen);
  return { surface, supersede: surface ? unseen.filter((k) => k !== surface) : [] };
}
