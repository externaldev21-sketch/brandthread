/**
 * Seller Discounts list helpers (app/discounts.tsx).
 *
 * Follows Shopify iOS "Discounts": All / Active / Scheduled / Expired filter
 * chips, rows grouped under a created-date header ("Today"), each row a code,
 * a status chip and a one-line summary joined with " • ".
 */
import { formatCents } from './money';

export type DiscountListStatus = 'active' | 'scheduled' | 'paused' | 'expired' | 'exhausted';
export type DiscountFilter = 'all' | 'active' | 'scheduled' | 'expired';

export const DISCOUNT_FILTERS: { id: DiscountFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'expired', label: 'Expired' },
];

export const DISCOUNT_STATUS_LABEL: Record<DiscountListStatus, string> = {
  active: 'Active', scheduled: 'Scheduled', paused: 'Paused', expired: 'Expired', exhausted: 'Used up',
};

export interface DiscountSummaryInput {
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping' | 'free_item';
  value: number;
  minOrderCents: number;
  appliesTo: 'entire_store' | 'specific_products' | 'collections';
  productIds: string[];
  collectionIds: string[];
  minQuantity: number;
  maxUses: number | null;
  usesCount: number;
  oneUsePerCustomer: boolean;
  firstOrderOnly: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  status: DiscountListStatus;
  createdAt: string;
}

/** Used-up codes have ended too, so they sit under "Expired"; paused codes only show under "All". */
export function matchesDiscountFilter(status: DiscountListStatus, filter: DiscountFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'expired') return status === 'expired' || status === 'exhausted';
  return status === filter;
}

export function matchesDiscountSearch(code: string, search: string): boolean {
  const term = search.trim().toUpperCase();
  return !term || code.toUpperCase().includes(term);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function scopeLabel(d: DiscountSummaryInput): string {
  if (d.appliesTo === 'collections') return plural(d.collectionIds.length, 'collection');
  if (d.appliesTo === 'specific_products') return plural(d.productIds.length, 'product');
  return 'all products';
}

/** "20% off all products • Minimum purchase of $50.00 • One use per customer" */
export function discountSummaryLine(d: DiscountSummaryInput): string {
  const scope = scopeLabel(d);
  const head = d.type === 'percentage'
    ? `${d.value}% off ${scope}`
    : d.type === 'fixed'
      ? `${formatCents(Math.round(d.value * 100))} off ${scope}`
      : d.type === 'free_shipping'
        ? `Free shipping on ${scope}`
        : `Free item on ${scope}`;
  const parts = [head];
  if (d.minOrderCents > 0) parts.push(`Minimum purchase of ${formatCents(d.minOrderCents)}`);
  if (d.minQuantity > 0) parts.push(`Minimum quantity of ${plural(d.minQuantity, 'item')}`);
  if (d.oneUsePerCustomer) parts.push('One use per customer');
  if (d.firstOrderOnly) parts.push('First order only');
  return parts.join(' • ');
}

function shortDate(iso: string, now: Date): string {
  const at = new Date(iso);
  return at.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Usage + schedule line: "3 of 100 used • Ends Oct 30". */
export function discountUsageLine(d: DiscountSummaryInput, now: Date = new Date()): string {
  const used = d.maxUses != null ? `${d.usesCount} of ${d.maxUses} used` : `${d.usesCount} used`;
  const parts = [used];
  if (d.startsAt && new Date(d.startsAt).getTime() > now.getTime()) parts.push(`Starts ${shortDate(d.startsAt, now)}`);
  else if (d.expiresAt) parts.push(`${new Date(d.expiresAt).getTime() < now.getTime() ? 'Ended' : 'Ends'} ${shortDate(d.expiresAt, now)}`);
  return parts.join(' • ');
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today" / "Yesterday" / "Oct 3" / "Oct 3, 2025". */
export function dayGroupLabel(iso: string, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return shortDate(iso, now);
}

/** Newest first, grouped by the day each code was created. */
export function groupDiscountsByDay<T extends Pick<DiscountSummaryInput, 'createdAt'>>(list: T[], now: Date = new Date()): { label: string; items: T[] }[] {
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups: { label: string; items: T[] }[] = [];
  for (const item of sorted) {
    const label = dayGroupLabel(item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
