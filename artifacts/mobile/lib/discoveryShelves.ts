/**
 * Pure helpers for the buyer discovery shelves (categories, trending
 * products/brands) and the drops calendar. No react-native imports so they
 * are unit-testable.
 */

export interface DiscoveryProductRow {
  id: string;
  name: string;
  images?: string[] | null;
  sellerDisplayName?: string | null;
  variants?: Array<{ priceCents?: number | null }> | null;
}

/** Lowest variant price in cents, or null when the product has no priced variant. */
export function lowestPriceCents(row: Pick<DiscoveryProductRow, 'variants'>): number | null {
  const prices = (row.variants ?? [])
    .map((v) => v.priceCents)
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function initialsOf(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Shape a public product row for the shared search ProductTile. */
export function toProductTileItem(row: DiscoveryProductRow, color: string) {
  const brand = row.sellerDisplayName ?? 'Seller';
  const priceCents = lowestPriceCents(row);
  return {
    id: row.id,
    name: row.name,
    brand,
    color,
    initials: initialsOf(row.name),
    imageUri: (row.images ?? []).find((i) => typeof i === 'string' && i.length > 0) ?? null,
    ...(priceCents != null ? { priceCents } : {}),
  };
}

export interface CalendarDrop {
  id: string;
  releaseAt?: string | null;
}

export interface CalendarDay<T extends CalendarDrop> {
  /** Local calendar day, YYYY-MM-DD. */
  key: string;
  date: Date;
  drops: T[];
}

function localKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Groups upcoming drops by the viewer's local calendar day, earliest day
 * first and earliest drop first within a day. Drops with no (or an
 * unparseable) release time are omitted; a calendar needs a date.
 */
export function groupDropsByDay<T extends CalendarDrop>(drops: T[]): Array<CalendarDay<T>> {
  const days = new Map<string, CalendarDay<T>>();
  for (const drop of drops) {
    if (!drop.releaseAt) continue;
    const at = new Date(drop.releaseAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = localKey(at);
    const day = days.get(key) ?? { key, date: new Date(at.getFullYear(), at.getMonth(), at.getDate()), drops: [] };
    day.drops.push(drop);
    days.set(key, day);
  }
  const out = [...days.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const day of out) {
    day.drops.sort((a, b) => new Date(a.releaseAt!).getTime() - new Date(b.releaseAt!).getTime() || a.id.localeCompare(b.id));
  }
  return out;
}

/** "Today", "Tomorrow", otherwise "Fri, Oct 2". */
export function dayHeading(day: Date, now: Date = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(day) - startOf(now)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Local release time, e.g. "9:00 AM". */
export function releaseTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export interface DiscoveryCategory {
  slug: string;
  label: string;
  productCount: number;
  coverImageUrl: string | null;
}

export interface TrendingBrandRow {
  id: string;
  name: string;
  verified: boolean;
  imageUri?: string;
  followersLabel?: string;
}

/** "1 follower" / "1.2K followers"; undefined when there are none to show. */
export function followersLabel(count: number): string | undefined {
  if (!Number.isFinite(count) || count <= 0) return undefined;
  if (count === 1) return '1 follower';
  if (count >= 1000) return `${(Math.round(count / 100) / 10).toString().replace(/\.0$/, '')}K followers`;
  return `${count} followers`;
}

/** API trending brand to the card shape the existing brand rail renders. */
export function mapTrendingBrand(b: {
  id: string; name: string; verified: boolean; logoUrl?: string | null; coverImageUrl?: string | null; followerCount?: number;
}): TrendingBrandRow {
  return {
    id: b.id,
    name: b.name,
    verified: !!b.verified,
    imageUri: b.coverImageUrl ?? b.logoUrl ?? undefined,
    followersLabel: followersLabel(b.followerCount ?? 0),
  };
}
