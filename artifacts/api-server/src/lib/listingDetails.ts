/**
 * Validation for `products.listing_details` — the resale-style attributes the
 * mobile Sell-an-item form captures (Vinted/Depop field set). Pure so it can
 * be unit-tested without a database.
 *
 * Unknown keys are dropped; every known key is optional. Returns
 * `{ value: null }` for null (clears the column) and `{ error }` for a
 * malformed payload so the route can answer 400.
 */

export const LISTING_CONDITIONS = ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"] as const;
export const LISTING_PARCEL_SIZES = ["small", "medium", "large"] as const;
export const LISTING_SHIPPING_PAYERS = ["buyer", "seller"] as const;

export type ListingCondition = (typeof LISTING_CONDITIONS)[number];
export type ListingParcelSize = (typeof LISTING_PARCEL_SIZES)[number];
export type ListingShippingPayer = (typeof LISTING_SHIPPING_PAYERS)[number];

export type ListingDetails = {
  department?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  condition?: ListingCondition;
  colors?: string[];
  material?: string;
  parcelSize?: ListingParcelSize;
  shippingPayer?: ListingShippingPayer;
};

const MAX_TEXT = 80;
const MAX_COLORS = 2;

function text(v: unknown, key: string): { ok: string | undefined } | { error: string } {
  if (v === undefined || v === null || v === "") return { ok: undefined };
  if (typeof v !== "string") return { error: `listingDetails.${key} must be a string` };
  const t = v.trim();
  if (t.length > MAX_TEXT) return { error: `listingDetails.${key} must be at most ${MAX_TEXT} characters` };
  return { ok: t || undefined };
}

function oneOf<T extends string>(v: unknown, key: string, allowed: readonly T[]): { ok: T | undefined } | { error: string } {
  if (v === undefined || v === null || v === "") return { ok: undefined };
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    return { error: `listingDetails.${key} must be one of ${allowed.join(", ")}` };
  }
  return { ok: v as T };
}

export function parseListingDetails(raw: unknown): { value: ListingDetails | null } | { error: string } {
  if (raw === null) return { value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "listingDetails must be an object" };
  const r = raw as Record<string, unknown>;
  const out: ListingDetails = {};

  for (const key of ["department", "category", "subcategory", "brand", "material"] as const) {
    const res = text(r[key], key);
    if ("error" in res) return res;
    if (res.ok !== undefined) out[key] = res.ok;
  }

  const condition = oneOf(r.condition, "condition", LISTING_CONDITIONS);
  if ("error" in condition) return condition;
  if (condition.ok) out.condition = condition.ok;

  const parcel = oneOf(r.parcelSize, "parcelSize", LISTING_PARCEL_SIZES);
  if ("error" in parcel) return parcel;
  if (parcel.ok) out.parcelSize = parcel.ok;

  const payer = oneOf(r.shippingPayer, "shippingPayer", LISTING_SHIPPING_PAYERS);
  if ("error" in payer) return payer;
  if (payer.ok) out.shippingPayer = payer.ok;

  if (r.colors !== undefined && r.colors !== null) {
    if (!Array.isArray(r.colors) || r.colors.length > MAX_COLORS) {
      return { error: `listingDetails.colors must be an array of at most ${MAX_COLORS} strings` };
    }
    const colors: string[] = [];
    for (const c of r.colors) {
      const res = text(c, "colors");
      if ("error" in res) return res;
      if (res.ok && !colors.includes(res.ok)) colors.push(res.ok);
    }
    if (colors.length) out.colors = colors;
  }

  return { value: Object.keys(out).length ? out : null };
}
