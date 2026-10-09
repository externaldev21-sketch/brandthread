/**
 * Pure rules for live commerce (pinned product, scheduled lives). No DB here so
 * every rule is unit-testable; routes/live-commerce.ts and
 * lib/scheduledLives.ts do the I/O.
 */

export const SCHEDULE_MIN_LEAD_MS = 60 * 1000;
export const SCHEDULE_MAX_LEAD_MS = 60 * 24 * 60 * 60 * 1000;
/** The "starting soon" reminder goes out this long before start. */
export const REMINDER_LEAD_MS = 10 * 60 * 1000;
export const MAX_SCHEDULED_PER_SELLER = 25;
export const MAX_TITLE_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_SCHEDULED_PRODUCTS = 50;

export interface ProductTag {
  productId: string;
  productName?: string;
  priceCents?: number;
  highlighted?: boolean;
  [key: string]: unknown;
}

/** Only `{productId: string}` tags survive; names/prices are display-only and clamped. */
export function sanitizeProductTags(input: unknown): ProductTag[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ProductTag[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const productId = (raw as any).productId;
    if (typeof productId !== "string" || !productId || seen.has(productId)) continue;
    seen.add(productId);
    const price = Number((raw as any).priceCents);
    out.push({
      productId,
      productName: typeof (raw as any).productName === "string" ? (raw as any).productName.slice(0, 120) : "Product",
      priceCents: Number.isInteger(price) && price >= 0 ? price : 0,
    });
    if (out.length >= MAX_SCHEDULED_PRODUCTS) break;
  }
  return out;
}

export type PinResult =
  | { ok: true; pinnedProductId: string | null; productTags: ProductTag[] }
  | { ok: false; error: string };

/**
 * Pin (or unpin with null) a product. The pinned product must be one of the
 * stream's tagged products. The legacy `highlighted` flag on the tags is kept
 * in step so older clients (buyer-live) keep reacting to the same product.
 */
export function applyPin(tags: unknown, productId: string | null): PinResult {
  const list: ProductTag[] = Array.isArray(tags) ? (tags as ProductTag[]) : [];
  if (productId === null) {
    return {
      ok: true,
      pinnedProductId: null,
      productTags: list.map((t) => ({ ...t, highlighted: false })),
    };
  }
  if (!list.some((t) => t && t.productId === productId)) {
    return { ok: false, error: "Tag the product on this live before pinning it" };
  }
  return {
    ok: true,
    pinnedProductId: productId,
    productTags: list.map((t) => ({ ...t, highlighted: t.productId === productId })),
  };
}

export type ScheduleValidation =
  | { ok: true; title: string; description: string | null; startsAt: Date }
  | { ok: false; error: string };

export function validateScheduleInput(
  input: { title?: unknown; description?: unknown; startsAt?: unknown },
  now: Date = new Date(),
): ScheduleValidation {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` };
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` };
  }
  if (typeof input.startsAt !== "string" && typeof input.startsAt !== "number") {
    return { ok: false, error: "startsAt is required" };
  }
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "startsAt is not a valid date" };
  const lead = startsAt.getTime() - now.getTime();
  if (lead < SCHEDULE_MIN_LEAD_MS) return { ok: false, error: "Pick a start time in the future" };
  if (lead > SCHEDULE_MAX_LEAD_MS) return { ok: false, error: "Live can be scheduled up to 60 days ahead" };
  return { ok: true, title, description: description || null, startsAt };
}

/** A scheduled live needs its "starting soon" reminder when it starts within the lead window (and hasn't started). */
export function reminderDue(
  row: { status: string; startsAt: Date; reminderSentAt: Date | null },
  now: Date,
  leadMs: number = REMINDER_LEAD_MS,
): boolean {
  if (row.status !== "scheduled" || row.reminderSentAt) return false;
  const untilStart = row.startsAt.getTime() - now.getTime();
  return untilStart <= leadMs && untilStart > -2 * 60 * 60 * 1000;
}

export function reminderCopy(title: string, startsAt: Date, now: Date): { title: string; body: string } {
  const mins = Math.max(1, Math.round((startsAt.getTime() - now.getTime()) / 60000));
  return {
    title: "Live starting soon",
    body: mins <= 1 ? `${title} starts in a minute.` : `${title} starts in ${mins} minutes.`,
  };
}
