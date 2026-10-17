/**
 * Live commerce client helpers: pinned product resolution, live-only codes,
 * scheduled lives, and the small "shopping from this live" context the
 * checkout reads so a live-only code validates against the right stream.
 *
 * Pure parts (no React Native imports) are unit-tested in
 * tests/live-commerce.test.ts.
 */
import { serviceRequest } from '@/lib/serviceConfig';

type Row = Record<string, any>;

// ─── Pinned product ──────────────────────────────────────────────────────────

/**
 * The product pinned on a stream row. An explicit pin (pin_updated_at set) wins
 * and may be null (the seller unpinned). Streams that never used the pin fall
 * back to the legacy `highlighted` tag, then the first tagged product.
 */
export function pinnedProductIdFromRow(row: Row): string | null {
  const tags: Row[] = Array.isArray(row.product_tags) ? row.product_tags : [];
  const ids = tags.filter(t => t && typeof t.productId === 'string').map(t => t.productId as string);
  if (row.pin_updated_at) {
    const pinned = row.pinned_product_id;
    return typeof pinned === 'string' && ids.includes(pinned) ? pinned : null;
  }
  const highlighted = tags.find(t => t?.highlighted)?.productId;
  return highlighted ?? ids[0] ?? null;
}

// ─── Live-only codes ─────────────────────────────────────────────────────────

export interface LiveCode {
  id: string;
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping' | 'free_item';
  value: number;
  minOrderCents: number;
  expiresAt: string | null;
}

export function describeLiveCode(c: Pick<LiveCode, 'type' | 'value'>): string {
  switch (c.type) {
    case 'percentage': return `${c.value}% off`;
    case 'fixed': return `$${c.value.toFixed(2)} off`;
    case 'free_shipping': return 'Free shipping';
    default: return 'Free item';
  }
}

export async function fetchLiveCodes(streamId: string): Promise<LiveCode[]> {
  const data = await serviceRequest<{ codes: LiveCode[] }>(`/api/live/${encodeURIComponent(streamId)}/codes`, {}, false);
  return data.codes ?? [];
}

// ─── Scheduled lives ─────────────────────────────────────────────────────────

export interface ScheduledLive {
  id: string;
  sellerId: string;
  title: string;
  description: string | null;
  /** ISO string. */
  startsAt: string;
  productTags: Array<{ productId: string; productName?: string; priceCents?: number }>;
  reminderCount: number;
  reminderSet: boolean;
  seller: { name: string; username: string | null; avatarUrl: string | null; verified: boolean };
}

export const fetchUpcomingLives = (sellerId?: string) =>
  serviceRequest<{ scheduled: ScheduledLive[] }>(
    `/api/live/scheduled/upcoming${sellerId ? `?sellerId=${encodeURIComponent(sellerId)}` : ''}`, {}, false,
  ).then(r => r.scheduled ?? []);

export const fetchMyScheduledLives = () =>
  serviceRequest<{ scheduled: ScheduledLive[] }>('/api/live/scheduled/mine', {}, false).then(r => r.scheduled ?? []);

export const createScheduledLive = (input: {
  title: string; description?: string; startsAt: string;
  productTags?: Array<{ productId: string; productName?: string; priceCents?: number }>;
}) =>
  serviceRequest<{ scheduled: ScheduledLive }>(
    '/api/live/scheduled', { method: 'POST', body: JSON.stringify(input) }, false,
  ).then(r => r.scheduled);

export const cancelScheduledLive = (id: string) =>
  serviceRequest<{ ok: boolean }>(`/api/live/scheduled/${encodeURIComponent(id)}`, { method: 'DELETE' }, false);

export const setScheduledLiveReminder = (id: string, on: boolean) =>
  serviceRequest<{ reminderSet: boolean }>(
    `/api/live/scheduled/${encodeURIComponent(id)}/remind`, { method: on ? 'PUT' : 'DELETE' }, false,
  );

/** A product the seller can tag on a scheduled live. */
export interface ScheduleProductOption { id: string; name: string; priceCents: number | null }

function toCents(value: unknown, unit: 'cents' | 'dollars'): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return unit === 'cents' ? Math.round(n) : Math.round(n * 100);
}

/**
 * Tolerant mapper for the seller's product list. GET /api/products returns a
 * bare array (with a `priceCents` "from" price), but older/other callers wrap
 * it as `{ products }` / `{ items }` — the Schedule Live picker used to read
 * only `r.products`, so it was always empty. Archived and malformed rows are
 * dropped; an unknown price stays null instead of becoming $0.
 */
export function toScheduleProductOptions(raw: unknown): ScheduleProductOption[] {
  const r = raw as Row | null | undefined;
  const list: unknown[] = Array.isArray(raw) ? raw
    : Array.isArray(r?.products) ? r!.products
    : Array.isArray(r?.items) ? r!.items
    : Array.isArray(r?.data) ? r!.data
    : [];
  const out: ScheduleProductOption[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Row;
    const id = typeof p.id === 'string' || typeof p.id === 'number' ? String(p.id) : '';
    const name = typeof p.name === 'string' ? p.name.trim() : typeof p.title === 'string' ? p.title.trim() : '';
    if (!id || !name || seen.has(id) || p.status === 'archived') continue;
    seen.add(id);
    const variantCents = Array.isArray(p.variants)
      ? p.variants.map((v: Row) => toCents(v?.priceCents, 'cents')).filter((c: number | null): c is number => c !== null)
      : [];
    const priceCents = toCents(p.priceCents, 'cents')
      ?? toCents(p.minPriceCents, 'cents')
      ?? toCents(p.pricing?.priceCents, 'cents')
      ?? (variantCents.length ? Math.min(...variantCents) : null)
      ?? toCents(p.price, 'dollars');
    out.push({ id, name, priceCents });
  }
  return out;
}

// ─── Schedule picker options (pure) ──────────────────────────────────────────

export interface DayOption { key: string; label: string; sub: string; date: Date }

/** Next `count` days starting today, as local-midnight dates. */
export function scheduleDayOptions(now: Date, count = 14): DayOption[] {
  const out: DayOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push({
      key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' }),
      sub: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      date: d,
    });
  }
  return out;
}

export interface TimeOption { key: string; label: string; hour: number; minute: number }

/** Half-hour slots across the day. */
export function scheduleTimeOptions(): TimeOption[] {
  const out: TimeOption[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = h % 12 === 0 ? 12 : h % 12;
      out.push({ key: `${h}:${m}`, label: `${hh}:${m === 0 ? '00' : '30'} ${h < 12 ? 'AM' : 'PM'}`, hour: h, minute: m });
    }
  }
  return out;
}

/** Combines a day and a slot into a Date (local time). */
export function combineSchedule(day: Date, time: Pick<TimeOption, 'hour' | 'minute'>): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute, 0, 0);
}
