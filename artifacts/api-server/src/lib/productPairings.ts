/**
 * "Complete the fit" rules — pure so they're unit-testable without a database.
 */

export const MAX_PRODUCT_PAIRINGS = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type PairingInputResult =
  | { ok: true; ids: string[] }
  | { ok: false; status: 400; error: string; code: string };

/** Shape-level validation of a PUT body: ordered, unique, ≤ cap, no self-pair. */
export function parsePairingInput(productId: string, raw: unknown): PairingInputResult {
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, error: "pairedProductIds must be an array", code: "invalid_body" };
  }
  if (!raw.every(isUuid)) {
    return { ok: false, status: 400, error: "pairedProductIds must be product ids", code: "invalid_body" };
  }
  const ids = raw.map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    return { ok: false, status: 400, error: "A product can only be paired once", code: "duplicate_pairing" };
  }
  if (ids.includes(productId.toLowerCase())) {
    return { ok: false, status: 400, error: "A product can't be paired with itself", code: "self_pairing" };
  }
  if (ids.length > MAX_PRODUCT_PAIRINGS) {
    return {
      ok: false,
      status: 400,
      error: `You can pair up to ${MAX_PRODUCT_PAIRINGS} products`,
      code: "pairing_cap",
    };
  }
  return { ok: true, ids };
}

/** Lowest variant price in cents (0 when a product has no variants). */
export function lowestPriceCents(variants: Array<{ priceCents: number | null }>): number {
  const prices = variants.map((v) => v.priceCents ?? 0);
  return prices.length ? Math.min(...prices) : 0;
}

/** Sellable now: any variant with stock, or a pre-order listing. */
export function isAvailable(variants: Array<{ stock: number | null }>, isPreOrder: boolean): boolean {
  return isPreOrder || variants.some((v) => (v.stock ?? 0) > 0);
}
