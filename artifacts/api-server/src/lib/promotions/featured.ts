/**
 * Pure rules for Featured brand slots: the server-side price list, how many
 * brands a placement can show at once, and the queue — the earliest window a
 * new purchase can occupy without exceeding capacity. No DB access here.
 */

export const FEATURED_PLACEMENT_DISCOVER = "discover_brands";
export type FeaturedPlacement = typeof FEATURED_PLACEMENT_DISCOVER;

/** Server-defined price list (integer cents). The client never sends a price. */
export const FEATURED_PRICE_LIST: Readonly<Record<number, number>> = {
  3: 2900,
  7: 5900,
  14: 9900,
};
export const FEATURED_DURATIONS = Object.keys(FEATURED_PRICE_LIST).map(Number).sort((a, b) => a - b);

/** An unpaid slot holds its place in the queue for this long. */
export const FEATURED_HOLD_MS = 30 * 60_000;
const DEFAULT_CAPACITY = 4;

export function featuredCapacity(): number {
  const raw = Number(process.env.FEATURED_SLOT_CAPACITY);
  return Number.isInteger(raw) && raw >= 1 && raw <= 24 ? raw : DEFAULT_CAPACITY;
}

export function featuredPriceCents(durationDays: unknown): number | null {
  if (typeof durationDays !== "number" || !Number.isInteger(durationDays)) return null;
  return FEATURED_PRICE_LIST[durationDays] ?? null;
}

export type Window = { startsAt: Date; endsAt: Date };
export type OccupyingSlot = Window & { status: string; createdAt: Date };

/** Whether a slot row currently occupies capacity (pending rows only while their hold is fresh). */
export function occupiesCapacity(slot: OccupyingSlot, now: Date): boolean {
  if (slot.endsAt <= now) return false;
  if (slot.status === "in_review" || slot.status === "approved") return true;
  if (slot.status === "pending_payment") return now.getTime() - slot.createdAt.getTime() < FEATURED_HOLD_MS;
  return false;
}

/** Highest number of slots simultaneously live at any instant inside [start, end). */
export function maxConcurrency(windows: readonly Window[], start: Date, end: Date): number {
  const events: Array<[number, number]> = [];
  for (const w of windows) {
    const s = Math.max(w.startsAt.getTime(), start.getTime());
    const e = Math.min(w.endsAt.getTime(), end.getTime());
    if (s < e) { events.push([s, 1]); events.push([e, -1]); }
  }
  // Ends sort before starts at the same instant: back-to-back slots do not overlap.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, delta] of events) { cur += delta; if (cur > max) max = cur; }
  return max;
}

export function hasCapacity(windows: readonly Window[], start: Date, end: Date, capacity: number): boolean {
  return maxConcurrency(windows, start, end) < capacity;
}

/**
 * Earliest start for a `durationDays` purchase such that the placement never
 * exceeds `capacity` during the window. Only `now` and the moments existing
 * slots end can be optimal starts, so those are the only candidates tried.
 */
export function earliestStart(
  windows: readonly Window[],
  durationDays: number,
  capacity: number,
  now: Date,
): Window {
  const durationMs = durationDays * 86_400_000;
  const candidates = [now.getTime(), ...windows.map((w) => w.endsAt.getTime()).filter((t) => t > now.getTime())]
    .sort((a, b) => a - b);
  for (const t of candidates) {
    const start = new Date(t);
    const end = new Date(t + durationMs);
    if (hasCapacity(windows, start, end, capacity)) return { startsAt: start, endsAt: end };
  }
  // Unreachable in practice (the latest end always frees capacity) but stay total.
  const last = new Date(Math.max(...candidates));
  return { startsAt: last, endsAt: new Date(last.getTime() + durationMs) };
}

/** Whether an approved, paid slot is in its live window. */
export function isSlotLive(slot: { status: string; paidAt: Date | null; startsAt: Date; endsAt: Date }, now: Date): boolean {
  return slot.status === "approved" && slot.paidAt != null && slot.startsAt <= now && slot.endsAt > now;
}

/** Seller-facing state label derived from a slot row. */
export function slotDisplayState(
  slot: { status: string; paidAt: Date | null; startsAt: Date; endsAt: Date },
  now: Date,
): "awaiting_payment" | "in_review" | "scheduled" | "live" | "rejected" | "ended" | "cancelled" {
  if (slot.status === "rejected") return "rejected";
  if (slot.status === "cancelled" || slot.status === "failed") return "cancelled";
  if (slot.status === "pending_payment") return "awaiting_payment";
  if (slot.status === "in_review") return "in_review";
  if (slot.endsAt <= now) return "ended";
  return slot.startsAt <= now ? "live" : "scheduled";
}
