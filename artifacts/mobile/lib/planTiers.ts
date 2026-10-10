/**
 * What each seller plan card says, built only from the shared plan config
 * (GET /api/config/seller-plans → lib/sellerPlanConfig.ts). Nothing here
 * hard-codes a number: change the config and the cards, the "Compare all
 * features" table and the upgrade sheet all follow.
 *
 * Dev's card order: the active-product count is the headline, then 4–5 key
 * differences, then "Compare all features".
 */
import type { SellerPlanId } from '@/lib/sellerBilling';

export type AnalyticsLevel = 'basic' | 'advanced' | 'full';
export type PayoutSpeed = 'standard' | 'faster';

/**
 * null = unlimited. A field missing from the config (undefined) is simply not
 * shown: the app never invents a number the server didn't send.
 */
export interface PlanTierLimits {
  activeProducts: number | null;
  staffSeats?: number | null;
  aiCreditsPerMonth?: number;
  marketingEmailsPerMonth?: number | null;
}

export interface PlanTierFeatures {
  analytics?: AnalyticsLevel;
  liveSelling?: boolean;
  dropsPreorders?: boolean;
  boostSlots?: boolean;
  customDomain?: boolean;
  manufacturerHub?: boolean;
  payoutSpeed?: PayoutSpeed;
  prioritySupport?: boolean;
}

export interface PlanTier {
  id: SellerPlanId;
  name: string;
  amountCents: number;
  limits: PlanTierLimits;
  features: PlanTierFeatures;
  /** Commission per sale on this plan, when the server sends it. */
  commissionPercent?: number;
}

const n = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;

/** The headline on each card: "List up to 10 products" / "Unlimited products". */
export function productHeadline(limits: PlanTierLimits): string {
  return limits.activeProducts === null
    ? 'Unlimited products'
    : `List up to ${plural(limits.activeProducts, 'product', 'products')}`;
}

function seatsLine(seats: number | null): string {
  return seats === null ? 'Unlimited staff seats' : plural(seats, 'staff seat', 'staff seats');
}

const ANALYTICS_LINE: Record<AnalyticsLevel, string> = {
  basic: 'Basic analytics',
  advanced: 'Advanced analytics',
  full: 'Full analytics and export',
};

function aiLine(credits: number): string {
  return `${plural(credits, 'AI credit', 'AI credits')} a month`;
}

/** Feature switches in the order they're named on a card. */
const UNLOCK_LABELS: { key: keyof PlanTierFeatures; label: string }[] = [
  { key: 'liveSelling', label: 'Live selling' },
  { key: 'dropsPreorders', label: 'drops and pre-orders' },
  { key: 'customDomain', label: 'custom domain' },
  { key: 'manufacturerHub', label: 'Manufacturer Hub' },
  { key: 'boostSlots', label: 'Boost slots' },
  { key: 'prioritySupport', label: 'Priority support' },
];

function joinLabels(labels: string[]): string {
  const text = labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Up to 5 lines under the headline: seats, analytics, AI credits, then what
 * this tier turns on that the tier below doesn't (at most two lines).
 */
export function keyDifferences(tier: PlanTier, below: PlanTier | null): string[] {
  const lines: string[] = [];
  if (tier.limits.staffSeats !== undefined) lines.push(seatsLine(tier.limits.staffSeats));
  if (tier.features.analytics) lines.push(ANALYTICS_LINE[tier.features.analytics]);
  if (tier.limits.aiCreditsPerMonth !== undefined) lines.push(aiLine(tier.limits.aiCreditsPerMonth));
  const unlocked = UNLOCK_LABELS
    .filter(({ key }) => tier.features[key] === true && (!below || below.features[key] !== true))
    .map(({ label }) => label);
  if (tier.features.payoutSpeed === 'faster' && below?.features.payoutSpeed !== 'faster') unlocked.push('faster payouts');
  for (let i = 0; i < unlocked.length && lines.length < 5; i += 3) {
    lines.push(joinLabels(unlocked.slice(i, i + 3)));
  }
  return lines;
}

export type CompareValue = string | boolean;

const HIDDEN = Symbol('hidden');
type Cell = CompareValue | typeof HIDDEN;

export interface CompareRow {
  label: string;
  values: CompareValue[];
}

function limitValue(value: number | null | undefined): Cell {
  if (value === undefined) return HIDDEN;
  if (value === null) return 'Unlimited';
  if (value === 0) return '—';
  return n(value);
}

function flag(value: boolean | undefined): Cell {
  return value === undefined ? HIDDEN : value;
}

/** Every difference, one row each, in tier order (the "Compare all features" sheet). */
export function compareRows(tiers: PlanTier[], commissionPercent: number | null): CompareRow[] {
  const analytics = { basic: 'Basic', advanced: 'Advanced', full: 'Full + export' } as const;
  const candidates: { label: string; cells: Cell[] }[] = [
    { label: 'Active products', cells: tiers.map((t) => limitValue(t.limits.activeProducts)) },
    { label: 'Staff seats', cells: tiers.map((t) => limitValue(t.limits.staffSeats)) },
    { label: 'Analytics', cells: tiers.map((t) => (t.features.analytics ? analytics[t.features.analytics] : HIDDEN)) },
    { label: 'AI credits a month', cells: tiers.map((t) => limitValue(t.limits.aiCreditsPerMonth)) },
    { label: 'Live selling', cells: tiers.map((t) => flag(t.features.liveSelling)) },
    { label: 'Drops and pre-orders with escrow', cells: tiers.map((t) => flag(t.features.dropsPreorders)) },
    { label: 'Marketing emails a month', cells: tiers.map((t) => limitValue(t.limits.marketingEmailsPerMonth)) },
    { label: 'Boost and featured slots', cells: tiers.map((t) => flag(t.features.boostSlots)) },
    { label: 'Custom domain', cells: tiers.map((t) => flag(t.features.customDomain)) },
    { label: 'Manufacturer Hub (RFQs, bulk orders)', cells: tiers.map((t) => flag(t.features.manufacturerHub)) },
    { label: 'Payout speed', cells: tiers.map((t) => (t.features.payoutSpeed ? (t.features.payoutSpeed === 'faster' ? 'Faster' : 'Standard') : HIDDEN)) },
    { label: 'Priority support', cells: tiers.map((t) => flag(t.features.prioritySupport)) },
  ];
  const rate = (t: PlanTier) => t.commissionPercent ?? commissionPercent;
  candidates.push({ label: 'Commission per sale', cells: tiers.map((t) => (rate(t) === null || rate(t) === undefined ? HIDDEN : `${rate(t)}%`)) });
  // A row shows only when every tier has a configured value for it.
  return candidates
    .filter((row) => row.cells.every((c) => c !== HIDDEN))
    .map((row) => ({ label: row.label, values: row.cells as CompareValue[] }));
}

/** The next tier up that lists more products than `limit`, if any. */
export function nextTierForProducts(tiers: PlanTier[], currentId: SellerPlanId): PlanTier | null {
  const i = tiers.findIndex((t) => t.id === currentId);
  if (i < 0) return null;
  const current = tiers[i].limits.activeProducts;
  return tiers.slice(i + 1).find((t) => current !== null && (t.limits.activeProducts === null || t.limits.activeProducts > current)) ?? null;
}

/**
 * The publish-at-cap sheet: "You've listed 10 of 10 products on Starter.
 * Upgrade to Growth to list up to 50."
 */
export function productCapCopy(tiers: PlanTier[], currentId: SellerPlanId, used: number): { title: string; body: string; next: PlanTier | null } | null {
  const current = tiers.find((t) => t.id === currentId);
  const limit = current?.limits.activeProducts;
  if (!current || limit === null || limit === undefined) return null;
  const next = nextTierForProducts(tiers, currentId);
  const listed = `You've listed ${n(Math.min(used, limit))} of ${plural(limit, 'product', 'products')} on ${current.name}.`;
  const upgrade = next
    ? next.limits.activeProducts === null
      ? ` Upgrade to ${next.name} to list unlimited products.`
      : ` Upgrade to ${next.name} to list up to ${n(next.limits.activeProducts)}.`
    : '';
  return { title: 'Product limit reached', body: `${listed}${upgrade} You can still save this as a draft.`, next };
}
