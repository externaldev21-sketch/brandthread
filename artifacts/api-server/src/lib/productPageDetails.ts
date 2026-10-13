/**
 * Product page details a seller sets per product (polish 87, 88, 93, 94):
 * the model line ("Model is 6'1", wearing L"), fabric / care / origin, and
 * one photo per colour.
 *
 * Pure validation so the route stays thin and the rules are unit-tested.
 */

export const DETAIL_TEXT_MAX = 300;
export const MODEL_SIZE_MAX = 12;
export const MODEL_HEIGHT_MIN_CM = 120;
export const MODEL_HEIGHT_MAX_CM = 230;
export const COLOR_NAME_MAX = 40;
export const COLOR_IMAGES_MAX = 30;

export interface ProductPageDetails {
  modelHeightCm: number | null;
  modelSizeWorn: string | null;
  fabric: string | null;
  care: string | null;
  origin: string | null;
  colorImages: Record<string, string>;
}

export type DetailsResult =
  | { ok: true; value: Partial<ProductPageDetails> }
  | { ok: false; error: string };

function text(value: unknown, field: string, max: number): { value: string | null } | { error: string } {
  if (value === null) return { value: null };
  if (typeof value !== "string") return { error: `${field} must be text` };
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > max) return { error: `${field} must be ${max} characters or fewer` };
  return { value: trimmed === "" ? null : trimmed };
}

/**
 * Validates a PUT body. Only keys that are present are returned, so a client
 * can save one field without clearing the others; `null` clears a field.
 *
 * Colour photos must be one of the product's own photos: the buyer's
 * gallery switches to that photo, so a URL outside the gallery would have
 * nothing to switch to.
 */
export function parseProductPageDetails(body: unknown, productImages: readonly string[]): DetailsResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Details must be an object" };
  const input = body as Record<string, unknown>;
  const out: Partial<ProductPageDetails> = {};

  if ("modelHeightCm" in input) {
    const h = input.modelHeightCm;
    if (h === null) out.modelHeightCm = null;
    else if (!Number.isInteger(h) || (h as number) < MODEL_HEIGHT_MIN_CM || (h as number) > MODEL_HEIGHT_MAX_CM) {
      return { ok: false, error: `Model height must be between ${MODEL_HEIGHT_MIN_CM} and ${MODEL_HEIGHT_MAX_CM} cm` };
    } else out.modelHeightCm = h as number;
  }

  const fields: Array<[keyof ProductPageDetails, string, number]> = [
    ["modelSizeWorn", "Size worn", MODEL_SIZE_MAX],
    ["fabric", "Fabric", DETAIL_TEXT_MAX],
    ["care", "Care", DETAIL_TEXT_MAX],
    ["origin", "Origin", DETAIL_TEXT_MAX],
  ];
  for (const [key, label, max] of fields) {
    if (!(key in input)) continue;
    const r = text(input[key], label, max);
    if ("error" in r) return { ok: false, error: r.error };
    (out as Record<string, unknown>)[key] = r.value;
  }

  if ("colorImages" in input) {
    const raw = input.colorImages;
    if (raw === null) out.colorImages = {};
    else if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Colour photos must be an object" };
    else {
      const entries = Object.entries(raw as Record<string, unknown>);
      if (entries.length > COLOR_IMAGES_MAX) return { ok: false, error: `Up to ${COLOR_IMAGES_MAX} colours` };
      const allowed = new Set(productImages);
      const colorImages: Record<string, string> = {};
      for (const [rawName, url] of entries) {
        const name = rawName.trim();
        if (!name || name.length > COLOR_NAME_MAX) return { ok: false, error: "Colour names must be 1–40 characters" };
        if (url === null || url === "") continue;
        if (typeof url !== "string" || !allowed.has(url)) {
          return { ok: false, error: `The photo for ${name} must be one of this product's photos` };
        }
        colorImages[name] = url;
      }
      out.colorImages = colorImages;
    }
  }

  return { ok: true, value: out };
}

/** Reads the stored row into the API shape (missing columns → empty). */
export function productPageDetailsOf(row: Partial<ProductPageDetails> | null | undefined): ProductPageDetails {
  const colorImages = row?.colorImages && typeof row.colorImages === "object" && !Array.isArray(row.colorImages)
    ? Object.fromEntries(Object.entries(row.colorImages).filter(([, v]) => typeof v === "string" && v)) as Record<string, string>
    : {};
  return {
    modelHeightCm: row?.modelHeightCm ?? null,
    modelSizeWorn: row?.modelSizeWorn ?? null,
    fabric: row?.fabric ?? null,
    care: row?.care ?? null,
    origin: row?.origin ?? null,
    colorImages,
  };
}

/** Minimum number of shoppers before "X people have this in their bag" shows (polish 91). */
export const IN_BAG_THRESHOLD = 3;

/** Hides small counts: below the threshold nobody sees a number. */
export function publicInBagCount(distinctShoppers: number): number | null {
  return Number.isInteger(distinctShoppers) && distinctShoppers >= IN_BAG_THRESHOLD ? distinctShoppers : null;
}

/** Price band for "Similar items" (polish 102): within ±40% of the product's lowest price. */
export const PRICE_BAND_RATIO = 0.4;

export function inPriceBand(currentCents: number | null | undefined, candidateCents: number | null | undefined): boolean {
  if (!currentCents || !candidateCents || currentCents <= 0 || candidateCents <= 0) return false;
  return Math.abs(candidateCents - currentCents) <= currentCents * PRICE_BAND_RATIO;
}
