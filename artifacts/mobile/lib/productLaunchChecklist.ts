/**
 * Launch readiness checklist + best time to launch — client view of
 *   GET /api/product-launches/:productId/checklist
 *   GET /api/product-launches/best-time?tz=
 * The server owns the done / blocking flags; this file owns the copy, the
 * screen each item opens, and the two checks the editor re-evaluates live
 * from its own form (launch time, notify followers).
 */
import { getTimeZoneOffsetMinutes, zonedTimeToUtc } from '@/lib/dropSchedule';

export type LaunchCheckId =
  | 'photos' | 'price' | 'stock' | 'variants' | 'description'
  | 'shipping' | 'payouts' | 'launch_time' | 'followers';

export interface LaunchCheck { id: LaunchCheckId; done: boolean; blocking: boolean }

export interface ProductLaunchChecklist {
  items: LaunchCheck[];
  readyCount: number;
  total: number;
  blockers: LaunchCheckId[];
  canSchedule: boolean;
  imageCount: number;
  followerCount: number;
}

export interface ActiveSlot { weekday: number; hour: number; followers: number }

export type BestTimeResponse =
  | { status: 'ok'; timeZone: string; days: number; activeFollowers: number; minActiveFollowers: number; grid: number[][]; byWeekday: number[]; top: ActiveSlot[] }
  | { status: 'not_enough_activity'; timeZone: string; days: number; activeFollowers: null; minActiveFollowers: number; grid: null; byWeekday: null; top: [] };

/** Task title per check, verb first (Shopify setup guide style). Same text done or open. */
export function launchCheckTitle(id: LaunchCheckId, counts: { followerCount?: number; imageCount?: number } = {}): string {
  const followerCount = counts.followerCount ?? 0;
  switch (id) {
    case 'photos': return counts.imageCount === 0 ? 'Add a photo' : 'Add 3 or more photos';
    case 'price': return 'Set a price';
    case 'stock': return 'Add stock or offer pre-order';
    case 'variants': return 'Add sizes or colors';
    case 'description': return 'Write a description';
    case 'shipping': return 'Set up shipping rates';
    case 'payouts': return 'Connect payouts';
    case 'launch_time': return 'Pick a time in the future';
    case 'followers': return followerCount > 0
      ? `Notify your ${followerCount.toLocaleString()} ${followerCount === 1 ? 'follower' : 'followers'}`
      : 'Notify your followers';
  }
}

/**
 * Screen that fixes a check. launch_time and followers are fixed in the
 * launch editor itself, so they have no route.
 */
export function launchCheckRoute(id: LaunchCheckId, productId: string): string | null {
  const p = encodeURIComponent(productId);
  switch (id) {
    case 'photos':
    case 'price':
    case 'description':
      return `/add-product?editId=${p}`;
    case 'stock':
    case 'variants':
      return `/product-variants?productId=${p}`;
    case 'shipping': return '/shipping';
    case 'payouts': return '/payouts';
    default: return null;
  }
}

/** Re-evaluates the two checks the editor owns from its live form state. */
export function withLiveChecks(
  checklist: ProductLaunchChecklist,
  live: { launchAt: Date | null; notifyFollowers: boolean },
  now: Date = new Date(),
): ProductLaunchChecklist {
  const items = checklist.items.map((item) => {
    if (item.id === 'launch_time') return { ...item, done: !!live.launchAt && live.launchAt.getTime() > now.getTime() };
    if (item.id === 'followers') return { ...item, done: live.notifyFollowers };
    return item;
  });
  return { ...checklist, items, readyCount: items.filter((i) => i.done).length };
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}
export const weekdayShort = (weekday: number) => WEEKDAY_SHORT[weekday] ?? '';
export const weekdayLong = (weekday: number) => WEEKDAY_LONG[weekday] ?? '';

/** "Thu 7 PM" */
export function slotLabel(slot: { weekday: number; hour: number }): string {
  return `${weekdayShort(slot.weekday)} ${hourLabel(slot.hour)}`;
}

/** "…most active on Thursday, between 7 PM and 8 PM." (TikTok Studio "Most active times" sentence) */
export function mostActiveSentence(slot: { weekday: number; hour: number }, days: number): string {
  return `In the last ${days} days, your followers were most active on ${weekdayLong(slot.weekday)}, between ${hourLabel(slot.hour)} and ${hourLabel(slot.hour + 1)}.`;
}

function pad(n: number) { return String(n).padStart(2, '0'); }

/**
 * The next future occurrence of a weekday/hour in `timeZone`, as the
 * editor's wall-clock pair ("YYYY-MM-DD", "HH:00"). Today counts when the
 * hour is still ahead.
 */
export function nextSlotWallClock(
  slot: { weekday: number; hour: number },
  timeZone: string,
  now: Date = new Date(),
): { date: string; time: string } {
  // Today's calendar date in the zone.
  const local = new Date(now.getTime() + getTimeZoneOffsetMinutes(now.getTime(), timeZone) * 60_000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  for (let i = 0; i <= 7; i++) {
    const day = new Date(Date.UTC(y, m, d + i));
    if (day.getUTCDay() !== slot.weekday) continue;
    const wall = { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: slot.hour, minute: 0 };
    if (zonedTimeToUtc(wall, timeZone).getTime() <= now.getTime()) continue;
    return { date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`, time: `${pad(slot.hour)}:00` };
  }
  // Unreachable: within 8 days the weekday recurs with the hour ahead.
  return { date: `${y}-${pad(m + 1)}-${pad(d)}`, time: `${pad(slot.hour)}:00` };
}

/** Only with `&demo=1` on the web preview; never used against a real account. */
export function buildDemoLaunchChecklist(): ProductLaunchChecklist {
  const open = new Set<LaunchCheckId>(['photos', 'variants', 'shipping']);
  const ids: LaunchCheckId[] = ['photos', 'price', 'stock', 'variants', 'description', 'shipping', 'payouts', 'launch_time', 'followers'];
  const items = ids.map((id) => ({ id, done: !open.has(id), blocking: false }));
  return { items, readyCount: items.filter((i) => i.done).length, total: items.length, blockers: [], canSchedule: true, imageCount: 2, followerCount: 1240 };
}

/** Only with `&demo=1` on the web preview: two scheduled launches and an unscheduled product. */
export function buildDemoLaunches(now: Date = new Date()) {
  const day = 24 * 3600 * 1000;
  const at = (days: number, hour: number) => { const d = new Date(now.getTime() + days * day); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const img = (n: string) => `https://cdn.brandthread.test/demo/${n}.jpg`;
  return {
    launches: [
      { productId: 'demo-launch-1', name: 'Heavyweight Hoodie — Ember', imageUrl: img('hoodie-ember'), status: 'active', launchAt: at(5, 19), launchedAt: null, notifyFollowers: true, alertCount: 38, readiness: { readyCount: 6, total: 9, blockers: [] as string[] } },
      { productId: 'demo-launch-2', name: 'Field Shell Jacket — Rust', imageUrl: img('jacket-rust'), status: 'active', launchAt: at(8, 10), launchedAt: null, notifyFollowers: false, alertCount: 4, readiness: { readyCount: 4, total: 9, blockers: ['price', 'payouts'] } },
    ],
    products: [
      { id: 'demo-launch-1', name: 'Heavyweight Hoodie — Ember', images: [img('hoodie-ember')], status: 'active' },
      { id: 'demo-launch-2', name: 'Field Shell Jacket — Rust', images: [img('jacket-rust')], status: 'active' },
      { id: 'demo-launch-3', name: 'Utility Cargo Pant — Rust', images: [img('cargo-rust')], status: 'active' },
    ],
  };
}

/** `&demo=1` checklist per demo product: warnings only, or blocked on price + payouts. */
export function buildDemoChecklistFor(productId: string): ProductLaunchChecklist {
  const base = buildDemoLaunchChecklist();
  if (productId !== 'demo-launch-2') return base;
  const open: LaunchCheckId[] = ['price', 'description', 'shipping', 'payouts', 'followers'];
  const blockers: LaunchCheckId[] = ['price', 'payouts'];
  const items = base.items.map((i) => ({ id: i.id, done: !open.includes(i.id), blocking: blockers.includes(i.id) }));
  return { ...base, items, readyCount: items.filter((i) => i.done).length, blockers, canSchedule: false, imageCount: 4 };
}

/** Only with `&demo=1` on the web preview. */
export function buildDemoBestTime(timeZone: string): BestTimeResponse {
  const grid = Array.from({ length: 7 }, (_, wd) => Array.from({ length: 24 }, (_, h) => {
    const evening = Math.max(0, 10 - Math.abs(h - 19) * 2);
    const lunch = Math.max(0, 5 - Math.abs(h - 12) * 2);
    const weekend = wd === 0 || wd === 6 ? 3 : 0;
    return h < 7 ? 0 : (evening + lunch + weekend) * (wd === 4 ? 9 : 6) + (wd * 7 + h) % 5;
  }));
  const slots: ActiveSlot[] = [];
  grid.forEach((row, weekday) => row.forEach((followers, hour) => slots.push({ weekday, hour, followers })));
  slots.sort((a, b) => b.followers - a.followers || a.weekday - b.weekday || a.hour - b.hour);
  return {
    status: 'ok', timeZone, days: 28, activeFollowers: 412, minActiveFollowers: 20, grid,
    byWeekday: grid.map((row) => Math.round(Math.max(...row) * 1.6)), top: slots.slice(0, 3),
  };
}
