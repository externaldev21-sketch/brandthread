/**
 * Discover "Drops" calendar (HYPE "Drops" list): live drops first under
 * "Live now", then upcoming drops grouped under one heading per local
 * release day ("Today", "Tomorrow", "Thu, Oct 16"), earliest first.
 * Pure helpers so the grouping is unit tested (tests/drop-calendar.test.ts).
 */
import type { DiscoverDrop } from '@/lib/discoverFeed';
import { dayHeading, groupDropsByDay } from '@/lib/discoveryShelves';

export type DropCalendarItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'drop'; key: string; drop: DiscoverDrop };

/** One row of `GET /api/public/drops?section=…` to the Discover drop shape. */
export function mapPublicDropRow(r: any, live: boolean): DiscoverDrop {
  return {
    id: String(r.id),
    name: r.name ?? r.title ?? 'Drop',
    brandName: r.brandName ?? r.seller?.brandName ?? r.seller?.displayName ?? r.sellerDisplayName ?? 'Brand',
    imageUri: r.imageUri ?? r.heroImageUrl ?? (r.images ?? [])[0] ?? undefined,
    releaseAt: r.releaseAt ?? null,
    live: live || !!r.live,
  };
}

/** Live + upcoming merged, deduped by id. A drop in both keeps its live row. */
export function mergeDiscoverDrops(live: DiscoverDrop[], upcoming: DiscoverDrop[]): DiscoverDrop[] {
  const byId = new Map<string, DiscoverDrop>();
  for (const d of [...live, ...upcoming]) {
    const prev = byId.get(d.id);
    if (!prev) byId.set(d.id, d);
    else if (!prev.live && d.live) byId.set(d.id, d);
  }
  return [...byId.values()];
}

function releaseMs(d: DiscoverDrop): number {
  const t = d.releaseAt ? new Date(d.releaseAt).getTime() : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Flat list items for the calendar: a header row before each section.
 * Live drops come first (by release time), then one section per local day.
 * Upcoming drops without a valid release time are left out; a calendar
 * needs a date.
 */
export function buildDropCalendarItems(drops: DiscoverDrop[], now: Date = new Date()): DropCalendarItem[] {
  const unique = mergeDiscoverDrops(drops.filter((d) => d.live), drops.filter((d) => !d.live));
  const live = unique.filter((d) => d.live)
    .sort((a, b) => releaseMs(a) - releaseMs(b) || a.id.localeCompare(b.id));
  const items: DropCalendarItem[] = [];
  if (live.length > 0) {
    items.push({ kind: 'header', key: 'h:live', title: 'Live now' });
    for (const d of live) items.push({ kind: 'drop', key: `d:${d.id}`, drop: d });
  }
  for (const day of groupDropsByDay(unique.filter((d) => !d.live))) {
    items.push({ kind: 'header', key: `h:${day.key}`, title: dayHeading(day.date, now) });
    for (const d of day.drops) items.push({ kind: 'drop', key: `d:${d.id}`, drop: d });
  }
  return items;
}
